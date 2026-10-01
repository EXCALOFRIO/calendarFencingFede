import * as cheerio from 'cheerio';
import { z } from 'zod';
import { normalizeSportName } from '@/lib/identity/resolver';
import { fixDoubleEncodedUtf8 } from '../fetcher';
import { mapCategory, mapGender, mapWeapon } from '../mappers';

/**
 * Adaptador de Engarde (engarde-service.com), fuente COMPLEMENTARIA de
 * clasificaciones finales cuando FIE/Skermo no publican la prueba.
 *
 * Estructura real comprobada el 2026-10-01 (Mediterráneo La Nucía 2024 y
 * Campeonato de Madrid ABS 2019):
 *  - Índice del torneo: `POST /prog/getCompeForDisplay.php` (formulario
 *    `option=competition&organism=…&event=…`) devuelve XML con un `<comp>` por
 *    prueba: arma, sexo, categoría, individual/equipos, fecha, ciudad y estado.
 *    La página HTML del torneo se rellena con ese XML mediante JavaScript, así
 *    que no trae las pruebas.
 *  - Prueba: `GET /competition/{org}/{evt}/{compe}` (con barra final da 404).
 *    Trae `<h1>` con la edición, la prueba, la sede y la fecha, y una tabla
 *    `table.liste` bajo «Clasificación general final». Los equipos ponen a sus
 *    integrantes en la misma celda separados por `<br>`.
 *  - Cuadros (`tableau16.htm`) son `table.tableau`: aquí sólo se reconocen y se
 *    anotan los enlaces que la prueba ofrece (`cuadros`); los asaltos se leen en
 *    `engarde-cuadro.ts`.
 *
 * Engarde NO publica un ID de tirador: las filas conservan nombre y nación/club
 * publicados y jamás se asignan a una persona por parecerse el nombre.
 */

export const ENGARDE_BASE = 'https://engarde-service.com';
export const ENGARDE_INDICE = `${ENGARDE_BASE}/prog/getCompeForDisplay.php`;
const FILAS_POR_PAGINA = 20;
const MAX_PAGINAS_INDICE = 25;

const segmento = /^[a-z0-9_-]{1,60}$/i;

export function esSegmentoEngarde(v: string): boolean {
  return segmento.test(v);
}

export function urlTorneoEngarde(org: string, evt: string): string {
  return `${ENGARDE_BASE}/tournament/${org}/${evt}`;
}
export function urlPruebaEngarde(org: string, evt: string, compe: string): string {
  return `${ENGARDE_BASE}/competition/${org}/${evt}/${compe}`;
}

// ---------------------------------------------------------------------------
// Fechas publicadas como texto
// ---------------------------------------------------------------------------

const MESES: string[][] = [
  ['enero', 'january', 'janvier', 'gennaio', 'januar', 'ene', 'jan', 'janv', 'gen'],
  ['febrero', 'february', 'fevrier', 'febbraio', 'februar', 'feb', 'fev', 'febr'],
  ['marzo', 'march', 'mars', 'marz', 'maerz', 'mar'],
  ['abril', 'april', 'avril', 'aprile', 'abr', 'apr', 'avr'],
  ['mayo', 'may', 'mai', 'maggio', 'mag'],
  ['junio', 'june', 'juin', 'giugno', 'juni', 'jun', 'giu'],
  ['julio', 'july', 'juillet', 'luglio', 'juli', 'jul', 'juil', 'lug'],
  ['agosto', 'august', 'aout', 'ago', 'aug'],
  ['septiembre', 'september', 'septembre', 'settembre', 'sep', 'sept', 'set'],
  ['octubre', 'october', 'octobre', 'ottobre', 'oktober', 'oct', 'okt', 'ott'],
  ['noviembre', 'november', 'novembre', 'nov'],
  ['diciembre', 'december', 'decembre', 'dicembre', 'dezember', 'dic', 'dec', 'dez'],
];

function plano(texto: string): string {
  return fixDoubleEncodedUtf8(texto)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isoValida(a: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 1900 || a > 2200) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

/**
 * Fecha ISO de un texto publicado («3 FEB 2024», «28 DE SEPTIEMBRE DE 2019»,
 * «January 2, 2026», «2024 02 03», «02.01.2026»). `null` si no es inequívoca:
 * nunca se completa un año ni un día ausentes.
 */
export function parsearFechaTexto(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = plano(raw);
  let m = t.match(/\b(\d{4})[ /.-](\d{1,2})[ /.-](\d{1,2})\b/);
  if (m) return isoValida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (m) return isoValida(Number(m[3]), Number(m[2]), Number(m[1]));
  const anio = t.match(/\b(\d{4})\b/);
  if (!anio) return null;
  const resto = t.replace(anio[0], ' ').replace(/\bde\b|\bdel\b|\bof\b|\bthe\b|,|\./g, ' ');
  const palabras = resto.split(/\s+/).filter(Boolean);
  let mes = 0;
  let dia: number | null = null;
  for (const p of palabras) {
    if (/^\d{1,2}(st|nd|rd|th|er)?$/.test(p)) {
      if (dia !== null) return null;
      dia = Number(p.replace(/\D/g, ''));
      continue;
    }
    const idx = MESES.findIndex((v) => v.includes(p));
    if (idx >= 0) {
      if (mes !== 0) return null;
      mes = idx + 1;
    }
  }
  if (!mes || dia === null) return null;
  return isoValida(Number(anio[1]), mes, dia);
}

// ---------------------------------------------------------------------------
// Índice del torneo (XML)
// ---------------------------------------------------------------------------

export type PruebaEngarde = {
  org: string;
  evt: string;
  compe: string;
  url: string;
  titulo: string;
  arma: ReturnType<typeof mapWeapon>;
  genero: ReturnType<typeof mapGender>;
  categoria: ReturnType<typeof mapCategory>;
  categoriaOriginal: string | null;
  /** El `<categorie>` y la «U17/U15» del título dicen cosas distintas: no se elige una. */
  categoriaContradictoria: boolean;
  individual: boolean | null;
  fecha: string | null;
  ciudad: string | null;
  pais: string | null;
  /** Estado bruto del índice (`completed`, `list`, …). */
  estado: string;
};

const atributosSchema = z.object({
  org: z.string().regex(segmento),
  evt: z.string().regex(segmento),
  compe: z.string().regex(segmento),
});

function categoriaDe(categorie: string | null, titulo: string) {
  const delIndice = mapCategory(categorie);
  const u = plano(titulo).match(/\bu\s?(\d{2})\b/);
  const deTitulo = u ? mapCategory(`U${u[1]}`) : null;
  if (delIndice && deTitulo && delIndice !== deTitulo) {
    return { categoria: null, contradictoria: true };
  }
  return { categoria: delIndice ?? deTitulo, contradictoria: false };
}

export type IndiceEngarde =
  | { ok: true; pruebas: PruebaEngarde[]; publicado: number | null; paginas: number; invalidas: number }
  | { ok: false; error: string };

/** Índice XML de un torneo. Una respuesta que no es el índice (HTML de error) es `ok:false`. */
export function parsearIndiceEngarde(xml: string): IndiceEngarde {
  const $ = cheerio.load(xml, { xmlMode: true });
  const raiz = $('comps');
  if (raiz.length === 0) return { ok: false, error: 'La respuesta no es el índice XML de Engarde' };
  const pruebas: PruebaEngarde[] = [];
  let invalidas = 0;
  raiz.find('comp').each((_, el) => {
    const c = $(el);
    const claves = atributosSchema.safeParse({
      org: c.attr('org'),
      evt: c.attr('evt'),
      compe: c.attr('compe'),
    });
    if (!claves.success) {
      invalidas += 1;
      return;
    }
    const { org, evt, compe } = claves.data;
    const titulo = c.children('titre').text().trim();
    const categorieTexto = c.children('categorie').text().trim() || null;
    const { categoria, contradictoria } = categoriaDe(categorieTexto, titulo);
    const arme = c.attr('arme')?.trim() ?? '';
    const indiv = c.attr('estindividuelle');
    pruebas.push({
      org,
      evt,
      compe,
      url: urlPruebaEngarde(org, evt, compe),
      titulo,
      arma: arme && arme !== '-' ? mapWeapon(arme) : null,
      genero: mapGender(c.attr('sexe')),
      categoria,
      categoriaOriginal: categorieTexto,
      categoriaContradictoria: contradictoria,
      individual: indiv === '1' ? true : indiv === '0' ? false : null,
      fecha: parsearFechaTexto(c.attr('date')),
      ciudad: c.attr('ville')?.trim() || null,
      pais: c.attr('pays')?.trim() || null,
      estado: (c.attr('etat') ?? '').trim(),
    });
  });
  const pag = raiz.children('pagination');
  const publicado = pag.attr('nbresultats') !== undefined ? Number(pag.attr('nbresultats')) : null;
  const paginas = pag.attr('nbpages') !== undefined ? Number(pag.attr('nbpages')) : 1;
  return {
    ok: true,
    pruebas,
    publicado: publicado !== null && Number.isFinite(publicado) ? publicado : null,
    paginas: Number.isFinite(paginas) && paginas > 0 ? paginas : 1,
    invalidas,
  };
}

/** Nombre del torneo publicado en la cabecera de su página (o de cualquiera de sus pruebas). */
export function parsearTorneoEngarde(html: string): { organizador: string | null; nombre: string | null } {
  const $ = cheerio.load(html);
  const limpio = (s: string) => fixDoubleEncodedUtf8(s).replace(/\s+/g, ' ').trim() || null;
  return {
    organizador: limpio($('.org-title').first().text()),
    nombre: limpio($('.tounament-title').first().text()),
  };
}

// ---------------------------------------------------------------------------
// Página de prueba (HTML)
// ---------------------------------------------------------------------------

export type FilaEngarde = {
  puestoRaw: string;
  puesto: number | null;
  /** Individual: «APELLIDO Nombre». Equipo: nombre del equipo. */
  nombre: string;
  nacion: string | null;
  club: string | null;
  equipo: boolean;
};

export type TipoPaginaEngarde = 'clasificacion' | 'clasificacion_provisional' | 'cuadro' | 'desconocida';

export type PaginaEngarde = {
  tipo: TipoPaginaEngarde;
  torneo: string | null;
  edicion: string | null;
  /** Primera línea de la cabecera de la prueba («MEN EPEE U17»). */
  titulo: string | null;
  fecha: string | null;
  encabezado: string | null;
  /** Total que declara el encabezado «(29 tiradores)»; `null` si no lo declara. */
  publicado: number | null;
  equipos: boolean;
  filas: FilaEngarde[];
  /** Filas de la tabla que no se pudieron leer. */
  anomalias: number;
  /** Rutas `/competition/{org}/{evt}/{compe}/tableau….htm` que la propia página ofrece. */
  cuadros: string[];
};

const FINAL = /\bfinal(e|es)?\b/;
const GENERAL = /(general|overall|clasificaci|classement|ranking)/;

function texto(el: cheerio.Cheerio<never> | cheerio.Cheerio<any>): string {
  return fixDoubleEncodedUtf8(el.text()).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function indiceColumna(cabeceras: string[], ...claves: string[]): number {
  return cabeceras.findIndex((h) => claves.some((c) => h.includes(c)));
}

export function parsearPaginaEngarde(html: string): PaginaEngarde {
  const $ = cheerio.load(html);
  const raiz = $('#reloadable').length > 0 ? $('#reloadable') : $('body');
  const h1 = raiz.find('h1').first();
  const lineas = (h1.find('small').first().html() ?? '')
    .split(/<br\s*\/?>/i)
    .map((l) => texto($(`<div>${l}</div>`)))
    .filter(Boolean);
  const h1Clon = h1.clone();
  h1Clon.find('small').remove();
  let fecha: string | null = null;
  for (const l of [...lineas].reverse()) {
    fecha = parsearFechaTexto(l);
    if (fecha) break;
  }
  const encabezado = texto(raiz.find('h3').first()) || null;
  const declarado = encabezado?.match(/\((\d+)\s+[^)]+\)/);
  const cuadros = [
    ...new Set(
      // El menú de la prueba queda fuera de `#reloadable`.
      $('a[href]')
        .map((_, a) => $(a).attr('href')?.match(/(\/competition\/[\w-]{1,60}\/[\w-]{1,60}\/[\w-]{1,60}\/tableau[\d-]{1,12}\.htm)(?:[?#]|$)/i)?.[1])
        .get()
        .filter((r): r is string => typeof r === 'string'),
    ),
  ];
  const base = {
    cuadros,
    torneo: texto($('.tounament-title').first()) || null,
    edicion: texto(h1Clon) || null,
    titulo: lineas[0] ?? null,
    fecha,
    encabezado,
    publicado: declarado ? Number(declarado[1]) : null,
  };

  if (raiz.find('table.tableau').length > 0) {
    return { ...base, tipo: 'cuadro', equipos: false, filas: [], anomalias: 0, publicado: null };
  }
  const tabla = raiz.find('table.liste').first();
  if (tabla.length === 0) {
    return { ...base, tipo: 'desconocida', equipos: false, filas: [], anomalias: 0, publicado: null };
  }
  const textoEncabezado = plano(encabezado ?? '');
  const esFinal = FINAL.test(textoEncabezado) && GENERAL.test(textoEncabezado);

  const cabeceras = tabla
    .find('th')
    .map((_, th) => plano(texto($(th))))
    .get();
  const iNombre = indiceColumna(cabeceras, 'apellido', 'nom', 'name');
  const iPrenom = indiceColumna(cabeceras, 'nombre', 'prenom', 'first');
  const iNacion = indiceColumna(cabeceras, 'nacion', 'nation', 'pais', 'pays');
  const iClub = indiceColumna(cabeceras, 'club');

  const filas: FilaEngarde[] = [];
  let anomalias = 0;
  let equipos = false;
  tabla.find('tr').each((_, tr) => {
    const celdas = $(tr).children('td');
    if (celdas.length === 0) return;
    const celdaNombre = iNombre >= 0 ? celdas.eq(iNombre) : null;
    const puestoRaw = texto(celdas.eq(0));
    if (!celdaNombre || celdaNombre.length === 0 || !puestoRaw) {
      anomalias += 1;
      return;
    }
    const lineasNombre = (celdaNombre.html() ?? '')
      .split(/<br\s*\/?>/i)
      .map((l) => texto($(`<div>${l}</div>`)))
      .filter(Boolean);
    const esEquipo = lineasNombre.length > 1;
    if (esEquipo) equipos = true;
    const nombre = esEquipo
      ? lineasNombre[0]
      : [lineasNombre[0], iPrenom >= 0 ? texto(celdas.eq(iPrenom)) : '']
          .filter(Boolean)
          .join(' ');
    if (!nombre) {
      anomalias += 1;
      return;
    }
    const nacionCelda = iNacion >= 0 ? celdas.eq(iNacion) : null;
    const nacion = nacionCelda
      ? texto(nacionCelda.find('span[translate="no"]').first()) || texto(nacionCelda) || null
      : null;
    filas.push({
      puestoRaw,
      puesto: /^\d{1,4}$/.test(puestoRaw) && Number(puestoRaw) > 0 ? Number(puestoRaw) : null,
      nombre,
      nacion,
      club: iClub >= 0 ? texto(celdas.eq(iClub)) || null : null,
      equipo: esEquipo,
    });
  });

  return {
    ...base,
    tipo: esFinal ? 'clasificacion' : 'clasificacion_provisional',
    equipos,
    filas,
    anomalias,
  };
}

// ---------------------------------------------------------------------------
// Puestos normalizados
// ---------------------------------------------------------------------------

export type PuestoComplementario = {
  /** Clave del hecho dentro de la prueba y la fuente; nunca el puesto. */
  clave: string;
  nombre: string;
  pais: string | null;
  club: string | null;
  posicion: number | null;
  posicionRaw: string;
  equipo: boolean;
};

/**
 * Puestos con clave estable por participante publicado (nombre normalizado +
 * nación o club). Dos filas idénticas reciben un ordinal para no pisarse.
 */
export function puestosDeEngarde(pagina: PaginaEngarde): PuestoComplementario[] {
  const usados = new Map<string, number>();
  return pagina.filas.map((f) => {
    const base = `engarde:${f.equipo ? 'team:' : ''}${normalizeSportName(f.nombre)}|${f.nacion ?? f.club ?? ''}`;
    const n = (usados.get(base) ?? 0) + 1;
    usados.set(base, n);
    return {
      clave: n === 1 ? base : `${base}#${n}`,
      nombre: f.nombre,
      pais: f.nacion,
      club: f.club,
      posicion: f.puesto,
      posicionRaw: f.puestoRaw,
      equipo: f.equipo,
    };
  });
}

// ---------------------------------------------------------------------------
// Lectura de red
// ---------------------------------------------------------------------------

export type RespuestaHttp = { status: number; body: string };

export type DepsEngarde = {
  /** No lanza por un estado HTTP: devuelve el código. Lanza sólo por red/timeout. */
  get: (url: string) => Promise<RespuestaHttp>;
  post: (url: string, formulario: Record<string, string>) => Promise<RespuestaHttp>;
  esperar?: (ms: number) => Promise<void>;
};

const USER_AGENT = 'CalendarioEsgrima/1.0 (+contacto)';

export const depsEngardeReales: DepsEngarde = {
  async get(url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(45_000),
      cache: 'no-store',
    });
    return { status: res.status, body: await res.text() };
  },
  async post(url, formulario) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/xml',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(formulario).toString(),
      signal: AbortSignal.timeout(45_000),
      cache: 'no-store',
    });
    return { status: res.status, body: await res.text() };
  },
};

function mensaje(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

export type LecturaTorneoEngarde = {
  org: string;
  evt: string;
  url: string;
  /** `sin_pruebas` = el índice respondió y declara 0: es un hecho publicado, no un error. */
  estado: 'ok' | 'sin_pruebas' | 'parcial' | 'error';
  nombre: string | null;
  pruebas: PruebaEngarde[];
  publicado: number | null;
  error: string | null;
};

function formularioIndice(org: string, evt: string, pagina: number): Record<string, string> {
  return {
    option: 'competition',
    sexe: '',
    arme: '',
    indiv: '',
    categorie: '',
    orderby: 'competitions_tournament',
    datefrom: '',
    dateto: '',
    country: '',
    city: '',
    type: '',
    state: '',
    page: String(pagina),
    lang: 'en',
    large: 'E',
    nrows: String(FILAS_POR_PAGINA),
    organism: org,
    event: evt,
    order: 'ASC',
    show_test: '0',
    cache: '1',
  };
}

export async function leerTorneoEngarde(
  org: string,
  evt: string,
  deps: DepsEngarde = depsEngardeReales,
): Promise<LecturaTorneoEngarde> {
  const url = urlTorneoEngarde(org, evt);
  const fallo = (error: string, pruebas: PruebaEngarde[] = [], publicado: number | null = null) =>
    ({
      org,
      evt,
      url,
      estado: pruebas.length > 0 ? 'parcial' : 'error',
      nombre: null,
      pruebas,
      publicado,
      error,
    }) satisfies LecturaTorneoEngarde;

  if (!esSegmentoEngarde(org) || !esSegmentoEngarde(evt)) {
    return fallo('Organizador o torneo con caracteres no válidos');
  }

  const pruebas: PruebaEngarde[] = [];
  let publicado: number | null = null;
  let paginas = 1;
  for (let pagina = 1; pagina <= Math.min(paginas, MAX_PAGINAS_INDICE); pagina += 1) {
    let r: RespuestaHttp;
    try {
      r = await deps.post(ENGARDE_INDICE, formularioIndice(org, evt, pagina));
    } catch (e) {
      return fallo(mensaje(e), pruebas, publicado);
    }
    if (r.status !== 200) return fallo(`HTTP ${r.status} al pedir el índice`, pruebas, publicado);
    const indice = parsearIndiceEngarde(r.body);
    if (!indice.ok) return fallo(indice.error, pruebas, publicado);
    publicado = indice.publicado;
    paginas = indice.paginas;
    for (const p of indice.pruebas) {
      if (!pruebas.some((q) => q.compe === p.compe)) pruebas.push(p);
    }
  }
  if (publicado !== null && pruebas.length < publicado) {
    return fallo(`Se leyeron ${pruebas.length} de ${publicado} pruebas publicadas`, pruebas, publicado);
  }

  let nombre: string | null = null;
  try {
    const r = await deps.get(url);
    if (r.status === 200) nombre = parsearTorneoEngarde(r.body).nombre;
  } catch {
    // El nombre sólo cualifica la serie; sin él la serie queda sin determinar, no inventada.
  }
  return {
    org,
    evt,
    url,
    estado: pruebas.length === 0 ? 'sin_pruebas' : 'ok',
    nombre,
    pruebas,
    publicado,
    error: null,
  };
}

export type EstadoLecturaComplementaria =
  | 'completo'
  | 'parcial'
  | 'sin_resultados'
  | 'no_publicado'
  | 'error';

export type LecturaClasificacionEngarde = {
  prueba: PruebaEngarde;
  url: string;
  estado: EstadoLecturaComplementaria;
  httpStatus: number | null;
  pagina: PaginaEngarde | null;
  publicado: number | null;
  importado: number;
  /** Texto corto y sin nombres, apto para guardar como motivo. */
  motivo: string | null;
};

function lectura(
  prueba: PruebaEngarde,
  r: Omit<LecturaClasificacionEngarde, 'prueba' | 'url'>,
): LecturaClasificacionEngarde {
  return { prueba, url: prueba.url, ...r };
}

/**
 * Distingue cuatro cosas que no son lo mismo:
 *  - `error`: la fuente falló (red, 5xx); no se sabe qué publica.
 *  - `no_publicado`: 404, prueba sólo con lista, o página sin clasificación final.
 *  - `sin_resultados`: clasificación final publicada y vacía (0 es un dato).
 *  - `completo`/`parcial`: filas leídas frente al total declarado (o a la tabla).
 */
export async function leerClasificacionEngarde(
  prueba: PruebaEngarde,
  deps: DepsEngarde = depsEngardeReales,
): Promise<LecturaClasificacionEngarde> {
  let r: RespuestaHttp;
  try {
    r = await deps.get(prueba.url);
  } catch (e) {
    return lectura(prueba, {
      estado: 'error',
      httpStatus: null,
      pagina: null,
      publicado: null,
      importado: 0,
      motivo: mensaje(e),
    });
  }
  if (r.status === 404) {
    return lectura(prueba, {
      estado: 'no_publicado',
      httpStatus: 404,
      pagina: null,
      publicado: null,
      importado: 0,
      motivo: 'La prueba no tiene página publicada (HTTP 404)',
    });
  }
  if (r.status !== 200) {
    return lectura(prueba, {
      estado: 'error',
      httpStatus: r.status,
      pagina: null,
      publicado: null,
      importado: 0,
      motivo: `HTTP ${r.status}`,
    });
  }
  const pagina = parsearPaginaEngarde(r.body);
  if (pagina.tipo !== 'clasificacion') {
    return lectura(prueba, {
      estado: 'no_publicado',
      httpStatus: 200,
      pagina,
      publicado: null,
      importado: 0,
      motivo:
        pagina.tipo === 'clasificacion_provisional'
          ? 'Sólo hay clasificación provisional, no la final'
          : 'La página no publica una clasificación final',
    });
  }
  const importado = pagina.filas.length;
  const total = pagina.publicado ?? importado;
  if (total === 0 && pagina.anomalias === 0) {
    return lectura(prueba, {
      estado: 'sin_resultados',
      httpStatus: 200,
      pagina,
      publicado: 0,
      importado: 0,
      motivo: null,
    });
  }
  const completo = importado === total && pagina.anomalias === 0;
  return lectura(prueba, {
    estado: completo ? 'completo' : 'parcial',
    httpStatus: 200,
    pagina,
    publicado: total,
    importado,
    motivo: completo ? null : `Se leyeron ${importado} de ${total} filas publicadas`,
  });
}
