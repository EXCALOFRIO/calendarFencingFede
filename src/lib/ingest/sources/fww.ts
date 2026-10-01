import * as cheerio from 'cheerio';
import { normalizeSportName } from '@/lib/identity/resolver';
import { fixDoubleEncodedUtf8 } from '../fetcher';
import { motivoHttp } from '../http-retry';
import { mapCategory } from '../mappers';
import {
  depsEngardeReales,
  parsearFechaTexto,
  type DepsEngarde,
  type EstadoLecturaComplementaria,
  type PuestoComplementario,
} from './engarde';

/**
 * Adaptador de Fencing Worldwide (Ophardt), fuente COMPLEMENTARIA igual que
 * Engarde. Estructura real comprobada el 2026-10-01 en una prueba pública:
 *
 *  - Prueba: `/{idioma}/{id}-{temporada}/` con sub-rutas `results/`,
 *    `participants/`, `pools/1`, `direct/2`. El `-2025` del identificador es la
 *    temporada, no el año de la fecha (una prueba del 02/01/2026 lo lleva).
 *  - `results/`: `table.startlist` con puesto («1.», «T3.» = empate), nación y
 *    nombre enlazado a `/athlete/{id}/`.
 *  - La miga de pan trae torneo, arma, género, categoría, modalidad, sede y
 *    fecha completa, pero NO en el idioma de la URL (una ruta `/en/` mostró
 *    «Degen / Herren / Einzel»): las etiquetas se reconocen en varios idiomas
 *    y una que no se reconoce queda `null`.
 */

export const FWW_BASE = 'https://www.fencingworldwide.com';

export type UrlFww = {
  idioma: string;
  id: string;
  temporada: string;
  /** Primer tramo tras el identificador: `results`, `pools`, `tournament`… o `null`. */
  seccion: string | null;
  /** Ruta completa tras el identificador sin barras sobrantes: `pools/1`, `direct/2`, `results` o `''`. */
  ruta: string;
};

const RUTA_FWW = /^[a-z0-9-]{1,30}$/i;

/** Sólo hosts de FWW y rutas `/{idioma}/{id}-{temporada}/…`; el resto es `null`. */
export function parsearUrlFww(entrada: string): UrlFww | null {
  let url: URL;
  try {
    url = new URL(entrada);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!/^(www\.)?fencingworldwide\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/([a-z]{2})\/(\d{1,9})-(\d{4})(\/.*)?$/i);
  if (!m) return null;
  const tramos = (m[4] ?? '').split('/').filter(Boolean);
  // Un tramo extraño (cifras, rutas de ficheros) no se conserva a medias: la URL no es de una prueba.
  if (tramos.length > 4 || tramos.some((t) => !RUTA_FWW.test(t))) return null;
  return {
    idioma: m[1].toLowerCase(),
    id: m[2],
    temporada: m[3],
    seccion: tramos[0]?.toLowerCase() ?? null,
    ruta: tramos.join('/').toLowerCase(),
  };
}

export function urlResultadosFww(u: Pick<UrlFww, 'id' | 'temporada'>): string {
  return `${FWW_BASE}/en/${u.id}-${u.temporada}/results/`;
}

export type DestinoFww = {
  tipo: 'prueba' | 'results' | 'pools' | 'direct' | 'otro';
  /** Número tras `pools/` o `direct/`. */
  numero: number | null;
};

/** Qué es lo que ofrece una URL FWW: la prueba, su clasificación, una ronda de poules o un cuadro. */
export function destinoFww(u: Pick<UrlFww, 'ruta'>): DestinoFww {
  if (u.ruta === '') return { tipo: 'prueba', numero: null };
  if (u.ruta === 'results') return { tipo: 'results', numero: null };
  const m = u.ruta.match(/^(pools|direct)\/(\d{1,2})$/);
  if (m) return { tipo: m[1] as 'pools' | 'direct', numero: Number(m[2]) };
  return { tipo: 'otro', numero: null };
}

function plano(t: string): string {
  return fixDoubleEncodedUtf8(t)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const ARMAS: [RegExp, 'ESPADA' | 'FLORETE' | 'SABLE'][] = [
  [/^(epee|degen|espada|spada)\b/, 'ESPADA'],
  [/^(foil|florett|florete|fleuret|fioretto)\b/, 'FLORETE'],
  [/^(sabre|sabel|sable|sciabola|saebel)\b/, 'SABLE'],
];
const GENEROS: [RegExp, 'M' | 'F' | 'MIXTO'][] = [
  [/^(men|man|herren|masculino|hommes?|uomini|maschile)\b/, 'M'],
  [/^(women|woman|damen|femenin[oa]|femmes?|donne|femminile)\b/, 'F'],
  [/^(mixed|mixto|gemischt|mixte|misto)\b/, 'MIXTO'],
];
const FORMATOS: [RegExp, 'INDIVIDUAL' | 'EQUIPOS'][] = [
  [/^(individual|einzel|individuel|individuale)\b/, 'INDIVIDUAL'],
  [/^(team|mannschaft|equipos?|equipe|squadre?)\b/, 'EQUIPOS'],
];

function clasificar<T>(tabla: [RegExp, T][], etiqueta: string): T | null {
  const t = plano(etiqueta).replace(/'s\b/g, '');
  for (const [re, valor] of tabla) if (re.test(t)) return valor;
  return null;
}

export type PaginaFww = {
  torneo: string | null;
  arma: 'ESPADA' | 'FLORETE' | 'SABLE' | null;
  genero: 'M' | 'F' | 'MIXTO' | null;
  categoria: ReturnType<typeof mapCategory>;
  categoriaOriginal: string | null;
  formato: 'INDIVIDUAL' | 'EQUIPOS' | null;
  ciudad: string | null;
  pais: string | null;
  fecha: string | null;
  /** `false` si la página no trae `table.startlist`: no hay clasificación publicada. */
  hayTabla: boolean;
  filas: FilaFww[];
  anomalias: number;
};

export type FilaFww = {
  puestoRaw: string;
  puesto: number | null;
  nombre: string;
  nacion: string | null;
  fwwId: string | null;
  equipo: boolean;
};

export function parsearResultadosFww(html: string): PaginaFww {
  const $ = cheerio.load(html);
  const limpio = (s: string) => fixDoubleEncodedUtf8(s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const items = $('ol.breadcrumb li')
    .map((_, li) => limpio($(li).text()))
    .get()
    .filter(Boolean);

  const pagina: PaginaFww = {
    torneo: items[0] ?? null,
    arma: null,
    genero: null,
    categoria: null,
    categoriaOriginal: null,
    formato: null,
    ciudad: null,
    pais: null,
    fecha: null,
    hayTabla: false,
    filas: [],
    anomalias: 0,
  };
  for (const item of items.slice(1)) {
    const sede = item.match(/^(.+?)\s*\(([A-Z]{3})\)$/);
    if (sede) {
      pagina.ciudad = sede[1];
      pagina.pais = sede[2];
      continue;
    }
    const fecha = parsearFechaTexto(item);
    if (fecha) {
      pagina.fecha = fecha;
      continue;
    }
    const arma = clasificar(ARMAS, item);
    if (arma) {
      pagina.arma = arma;
      continue;
    }
    const genero = clasificar(GENEROS, item);
    if (genero) {
      pagina.genero = genero;
      continue;
    }
    const formato = clasificar(FORMATOS, item);
    if (formato) {
      pagina.formato = formato;
      continue;
    }
    const categoria = mapCategory(item);
    if (categoria) {
      pagina.categoria = categoria;
      pagina.categoriaOriginal = item;
    }
  }

  const tabla = $('table.startlist').first();
  if (tabla.length === 0) return pagina;
  pagina.hayTabla = true;
  tabla.find('tbody tr').each((_, tr) => {
    const celdas = $(tr).children('td');
    const puestoRaw = limpio(celdas.eq(0).text());
    const enlace = $(tr).find('td.name a[href^="/athlete/"]').first();
    const nombre = limpio(enlace.length > 0 ? enlace.text() : $(tr).find('td.name').text());
    if (!puestoRaw || !nombre) {
      pagina.anomalias += 1;
      return;
    }
    const id = enlace.attr('href')?.match(/^\/athlete\/(\d+)\/?$/)?.[1] ?? null;
    const rango = puestoRaw.match(/^T?(\d{1,4})\.?$/i);
    pagina.filas.push({
      puestoRaw,
      puesto: rango && Number(rango[1]) > 0 ? Number(rango[1]) : null,
      nombre,
      nacion: limpio(celdas.eq(1).text()) || null,
      fwwId: id,
      equipo: pagina.formato === 'EQUIPOS',
    });
  });
  return pagina;
}

export function puestosDeFww(pagina: PaginaFww): PuestoComplementario[] {
  const usados = new Map<string, number>();
  return pagina.filas.map((f) => {
    const base = f.fwwId
      ? `fww:athlete:${f.fwwId}`
      : `fww:${f.equipo ? 'team:' : ''}${normalizeSportName(f.nombre)}|${f.nacion ?? ''}`;
    const n = (usados.get(base) ?? 0) + 1;
    usados.set(base, n);
    return {
      clave: n === 1 ? base : `${base}#${n}`,
      nombre: f.nombre,
      pais: f.nacion,
      club: null,
      posicion: f.puesto,
      posicionRaw: f.puestoRaw,
      equipo: f.equipo,
    };
  });
}

export type LecturaResultadosFww = {
  url: string;
  estado: EstadoLecturaComplementaria;
  httpStatus: number | null;
  pagina: PaginaFww | null;
  publicado: number | null;
  importado: number;
  motivo: string | null;
};

/** Mismos estados que Engarde: 404/sin tabla = no publicado, tabla vacía = cero publicado. */
export async function leerResultadosFww(
  entrada: string,
  deps: Pick<DepsEngarde, 'get'> = depsEngardeReales,
): Promise<LecturaResultadosFww> {
  const u = parsearUrlFww(entrada);
  if (!u) {
    return {
      url: entrada,
      estado: 'error',
      httpStatus: null,
      pagina: null,
      publicado: null,
      importado: 0,
      motivo: 'La URL no es una prueba de Fencing Worldwide',
    };
  }
  const url = urlResultadosFww(u);
  const vacia = (estado: EstadoLecturaComplementaria, httpStatus: number | null, motivo: string) => ({
    url,
    estado,
    httpStatus,
    pagina: null,
    publicado: null,
    importado: 0,
    motivo,
  });
  let r;
  try {
    r = await deps.get(url);
  } catch (e) {
    return vacia('error', null, (e instanceof Error ? e.message : String(e)).slice(0, 300));
  }
  if (r.status === 404) return vacia('no_publicado', 404, 'La prueba no tiene página publicada (HTTP 404)');
  if (r.status !== 200) return vacia('error', r.status, motivoHttp(r.status, r.retryAfterMs));
  const pagina = parsearResultadosFww(r.body);
  if (!pagina.hayTabla) {
    return { ...vacia('no_publicado', 200, 'La página no publica una clasificación'), pagina };
  }
  const importado = pagina.filas.length;
  if (importado === 0 && pagina.anomalias === 0) {
    return { url, estado: 'sin_resultados', httpStatus: 200, pagina, publicado: 0, importado: 0, motivo: null };
  }
  const completo = pagina.anomalias === 0;
  return {
    url,
    estado: completo ? 'completo' : 'parcial',
    httpStatus: 200,
    pagina,
    publicado: importado + pagina.anomalias,
    importado,
    motivo: completo ? null : `${pagina.anomalias} filas ilegibles`,
  };
}
