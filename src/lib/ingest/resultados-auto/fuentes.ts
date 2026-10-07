/**
 * Lectores deterministas de la ingesta automática. Cada uno devuelve hechos en el formato común
 * (`hechos/formato.ts`) con los MISMOS conversores que el lote manual, así que las claves y el
 * contenido son los del lote. No escriben nada.
 */
import { createHash } from 'node:crypto';
import { convertirPrueba } from '../hechos/fie';
import { hechosSkermo } from '../hechos/skermo';
import {
  casarConSkermo, categoriaEngarde, convertirPrueba as convertirEngarde, generoEngarde, nombresDeHechos,
  paginasDePrueba, temporadaRfee, validarMarcadores, type Paginas, type PruebaIndice,
} from '../hechos/engarde';
import { lecturaAHechos } from '../hechos/pdf';
import type { IndiceFechas } from '../hechos/fechas-catalogo';
import type { HechosPrueba } from '../hechos/formato';
import {
  parseSkermoResultsIndex, parseSkermoSeasons, skermoCompetitionResultsUrl, skermoResultsUrl,
  type SkermoResultsIndexRow,
} from '../sources/skermo-results';
import { filaCatalogoFie, urlPruebasFie } from '../sources/historico-indice';
import {
  ENGARDE_BASE, esSegmentoEngarde, leerTorneoEngarde, urlPruebaEngarde, type DepsEngarde,
} from '../sources/engarde';
import { docIdDeUrl, docIdLegadoDeUrl, extraerPaginas, PdfNoLeible, sha256Hex } from '../sources/rfee-pdf/lectura';
import { leerResultadosPdf } from '../sources/rfee-pdf/resultados';
import type { LecturaPdf, PaginaTexto } from '../sources/rfee-pdf/tipos';
import { RedDetenida, type Red } from './red';
import type { BaseResultados } from './sql';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ FIE

export type FilaFie = { competitionId: number; season: number; fecha: string | null; formato: string | null };

/** Una página del catálogo de la temporada FIE (100 pruebas por página). */
export async function leerCatalogoFie(red: Red, season: number, pagina: number): Promise<{ filas: FilaFie[]; total: number }> {
  const r = await red.json(urlPruebasFie(season, pagina)) as { totalFound?: unknown; items?: unknown };
  const total = Number(r?.totalFound);
  if (!Number.isSafeInteger(total) || !Array.isArray(r?.items)) throw new Error('resultados_auto_catalogo_fie_forma');
  const filas: FilaFie[] = [];
  for (const item of r.items) {
    const f = filaCatalogoFie(item);
    if (!f?.clavePrueba || f.temporada !== String(season)) continue;
    filas.push({ competitionId: Number(f.clavePrueba), season, fecha: f.fecha, formato: f.formato });
  }
  return { filas, total };
}

export type LecturaHechos = {
  hechos: HechosPrueba[];
  /** La fuente ya da la prueba por terminada y publicada entera. */
  final: boolean;
  /** Motivo por el que todavía no hay nada que cargar. */
  esperar?: string;
};

export async function leerPruebaFieAuto(red: Red, season: number, competitionId: number, hoy: string): Promise<LecturaHechos> {
  const memo = new Map<string, Promise<unknown>>();
  const fetchJson = (url: string) => {
    let p = memo.get(url);
    if (!p) memo.set(url, (p = red.json(url)));
    return p;
  };
  const usadas: string[] = [];
  const conv = await convertirPrueba(season, competitionId, async (url) => { usadas.push(url); return fetchJson(url); }, {
    tamanoPagina: 200, sourceSha256: (u) => sha(JSON.stringify([...new Set(u)].sort())),
  });
  // The reader swallows fetch errors as "error" sections: a budget cut is not a source answer.
  if (red.detenida) throw red.detenida;
  if (!conv.ok) {
    if (conv.codigo === 'metadata') return { hechos: [], final: false, esperar: 'fie_sin_metadatos' };
    throw new Error(`resultados_auto_fie_${conv.codigo}`);
  }
  const h = conv.hechos;
  const fin = h.edition.endDate ?? h.competition.date;
  if (!fin || fin >= hoy) return { hechos: [], final: false, esperar: 'fie_en_curso' };
  if (h.results.length === 0) return { hechos: [], final: false, esperar: 'fie_sin_clasificacion' };
  if (h.status.results !== 'completo') return { hechos: [], final: false, esperar: 'fie_clasificacion_parcial' };
  const terminada = (e: string) => e === 'completo' || e === 'sin_resultados';
  return { hechos: [h], final: terminada(h.status.pools) && terminada(h.status.tableau) };
}

// ------------------------------------------------------------------ Skermo (RFEE)

export async function leerIndiceSkermo(red: Red, season: string): Promise<SkermoResultsIndexRow[] | null> {
  const base = await red.texto(skermoResultsUrl('RFEE', { includePrevious: false }));
  const s = parseSkermoSeasons(base).find((x) => x.label === season);
  if (!s) return null;
  const html = s.selected ? base : await red.texto(skermoResultsUrl('RFEE', { season: s.value, includePrevious: false }));
  if (!parseSkermoSeasons(html).some((x) => x.label === season && x.selected)) throw new Error('resultados_auto_skermo_temporada');
  const indice = parseSkermoResultsIndex(html, { federationCode: 'RFEE' });
  if (indice.mismatches) throw new Error('resultados_auto_skermo_indice_columnas');
  return indice.rows;
}

export async function leerClasificacionSkermo(red: Red, competitionId: string, hoy: string): Promise<LecturaHechos> {
  const html = await red.texto(skermoCompetitionResultsUrl('RFEE', competitionId));
  const h = hechosSkermo(competitionId, html, sha(html));
  if (!h) return { hechos: [], final: false, esperar: 'skermo_sin_clasificacion' };
  if ((h.competition.date ?? hoy) >= hoy) return { hechos: [], final: false, esperar: 'skermo_en_curso' };
  return { hechos: [h], final: h.status.results === 'completo' };
}

// ------------------------------------------------------------------ Engarde

export type EnlaceEngarde = { org: string; evt: string; compe: string | null };

/** `engarde-service.com/competition/{org}/{evt}[/{compe}]` o `/tournament/{org}/{evt}`. */
export function enlaceEngarde(url: string): EnlaceEngarde | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/^(www\.)?engarde-service\.com$/i.test(u.hostname)) return null;
  const partes = u.pathname.split('/').filter(Boolean);
  if ((partes[0] === 'competition' || partes[0] === 'tournament') && partes.length >= 3) {
    const [, org, evt, compe] = partes;
    if (!esSegmentoEngarde(org) || !esSegmentoEngarde(evt)) return null;
    return { org, evt, compe: compe && esSegmentoEngarde(compe) ? compe : null };
  }
  return null;
}

function depsEngarde(red: Red): DepsEngarde {
  const envolver = async (f: () => Promise<string>) => {
    try {
      return { status: 200, body: await f() };
    } catch (e) {
      if (e instanceof RedDetenida) throw e;
      const m = /resultados_auto_http_(\d+)/.exec(String((e as Error)?.message));
      if (m) return { status: Number(m[1]), body: '' };
      throw e;
    }
  };
  return {
    get: (url) => envolver(() => red.texto(url)),
    post: (url, form) => envolver(() => red.texto(url, { method: 'POST', form })),
  };
}

export type PruebaSkermoObjetivo = {
  id: string;
  weapon: string;
  gender: string;
  category: string;
  fecha: string;
  hechos: HechosPrueba;
};

/**
 * La prueba de Engarde que es esta prueba de Skermo, leída entera (clasificación, poules y
 * cuadro). Mismas reglas que el lote (`lote7-skermo-engarde.ts`): misma arma, género compatible,
 * ±1 día, la categoría del índice o la de Skermo, marcadores coherentes y el casamiento por
 * nombres (≥80 % de los tiradores de Skermo en Engarde).
 */
export async function leerEngardeDeSkermo(
  red: Red, enlace: EnlaceEngarde, objetivo: PruebaSkermoObjetivo,
): Promise<{ hechos: HechosPrueba | null; motivo: string; terminada: boolean }> {
  const torneo = await leerTorneoEngarde(enlace.org, enlace.evt, depsEngarde(red));
  if (red.detenida) throw red.detenida;
  if (torneo.estado === 'error') return { hechos: null, motivo: 'engarde_indice_error', terminada: false };
  const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);
  // The link may point to a sibling competition of the same tournament (TNR M17 em/ef).
  const candidatas = torneo.pruebas.filter((p) => p.individual === true && p.arma === objetivo.weapon &&
    (!p.genero || p.genero === 'MIXTO' || objetivo.gender === 'MIXTO' || p.genero === objetivo.gender) &&
    (!p.fecha || Math.abs(dia(p.fecha) - dia(objetivo.fecha)) <= 1));
  if (candidatas.length === 0) return { hechos: null, motivo: 'engarde_sin_prueba_compatible', terminada: false };
  const fechas = torneo.pruebas.map((p) => p.fecha).filter((f): f is string => !!f).sort();
  let elegida: { h: HechosPrueba; terminada: boolean } | null = null;
  for (const p of candidatas.slice(0, 3)) {
    const prueba: PruebaIndice = {
      ...p, sexe: null, generoFinal: generoEngarde(p, null) ?? (objetivo.gender as PruebaIndice['generoFinal']),
      categoriaFinal: categoriaEngarde(p.categoriaOriginal, p.titulo) ?? (objetivo.category as PruebaIndice['categoriaFinal']),
    };
    const portada = await red.texto(urlPruebaEngarde(p.org, p.evt, p.compe));
    const paginas: Paginas = { prueba: portada, clasfinal: null, poules: [], cuadros: [], faltan: [] };
    for (const nombre of paginasDePrueba(portada, p.org, p.evt, p.compe).slice(0, 16)) {
      let html: string;
      try {
        html = await red.texto(`${ENGARDE_BASE}/competition/${p.org}/${p.evt}/${p.compe}/${nombre}`);
      } catch (e) {
        if (e instanceof RedDetenida) throw e;
        paginas.faltan.push(nombre);
        continue;
      }
      const np = nombre.match(/^poules(\d+)\.htm$/i);
      if (/^clasfinal\.htm$/i.test(nombre)) paginas.clasfinal = html;
      else if (np) paginas.poules.push({ pagina: Number(np[1]), html });
      else paginas.cuadros.push({ url: `${urlPruebaEngarde(p.org, p.evt, p.compe)}/${nombre}`, html });
    }
    const fechaP = p.fecha ?? objetivo.fecha;
    const r = convertirEngarde(prueba, paginas, {
      season: temporadaRfee(fechaP), nombreTorneo: torneo.nombre ?? `${p.org}/${p.evt}`,
      inicio: fechas[0] ?? fechaP, fin: fechas.at(-1) ?? fechaP, ciudad: p.ciudad,
    });
    if (!r.ok) continue;
    const h = validarMarcadores(r.hechos).hechos;
    const casa = casarConSkermo(
      { weapon: h.competition.weapon, gender: h.competition.gender, fecha: h.competition.date ?? fechaP, nombres: nombresDeHechos(h) },
      [{ id: objetivo.id, source: 'skermo_rfee', weapon: objetivo.weapon, gender: objetivo.gender, fecha: objetivo.fecha,
        nombres: nombresDeHechos(objetivo.hechos) }]);
    if (casa.casan.length !== 1) continue;
    if (elegida) return { hechos: null, motivo: 'engarde_varias_pruebas_casan', terminada: false };
    elegida = { h, terminada: p.estado === 'completed' };
  }
  if (!elegida) return { hechos: null, motivo: 'engarde_no_casa_por_nombres', terminada: false };
  return { hechos: elegida.h, motivo: 'ok', terminada: elegida.terminada };
}

// ------------------------------------------------------------------ PDF RFEE

export type FilaCatalogoPdf = { fecha: string; arma: string | null; genero: string | null; categoria: string | null; formato: string | null };

export type LecturaPdfAuto = {
  docId: string;
  lectura: LecturaPdf;
  /** Texto de cada página (para la validación de la IA y su prompt). */
  textos: string[];
  hechos: HechosPrueba[];
  descartadas: number;
  motivosDescarte: string[];
  ocr: boolean;
};

/** Texto por líneas de una página: elementos agrupados por altura y ordenados de izquierda a derecha. */
export function textoDePagina(p: PaginaTexto): string {
  const lineas: { y: number; items: { x: number; s: string }[] }[] = [];
  for (const it of [...p.items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const l = lineas.find((x) => Math.abs(x.y - it.y) <= Math.max(2, it.h * 0.4));
    if (l) l.items.push({ x: it.x, s: it.s });
    else lineas.push({ y: it.y, items: [{ x: it.x, s: it.s }] });
  }
  return lineas.map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(' ')).join('\n');
}

/** Mismo namespace que `pdf-a-hechos.ts#resolverDocId` / `pdf-db.ts#resolverDocumento`, contra D1. */
export async function resolverDocIdD1(base: BaseResultados, season: string, url: string): Promise<string> {
  const sugerido = docIdDeUrl(url);
  const urls = async (docId: string) => {
    const filas = await base.leer<{ u: string | null }>(
      `select source_url u from sport_import_coverage where source='rfee_pdf' and fact_kind='pdf' and season=? and competition_key=?
       union all select source_url u from sport_edition where source='rfee_pdf' and season=? and tournament_key=?`,
      [season, `doc:${docId}`, season, `pdf:${docId}`]);
    return filas.map((f) => f.u);
  };
  const conflictos = (lista: (string | null)[]) => lista.filter((u) => !(u === url || (u !== null && u.startsWith(`${url}#`)))).length;
  const actual = await urls(sugerido);
  if (conflictos(actual) > 0) throw new Error('pdf_document_namespace_conflict');
  if (actual.length > 0) return sugerido;
  const legado = docIdLegadoDeUrl(url);
  if (legado !== sugerido) {
    const filas = await urls(legado);
    if (filas.length > 0 && conflictos(filas) === 0) return legado;
  }
  return sugerido;
}

export async function leerPdfAuto(
  red: Red, base: BaseResultados, url: string, season: string, filasCatalogo: readonly FilaCatalogoPdf[],
  limites: { maxBytes: number; maxPaginas: number; comprobar: () => void },
): Promise<LecturaPdfAuto> {
  const bytes = await red.bytes(url, limites.maxBytes);
  const huella = await sha256Hex(bytes);
  const docId = await resolverDocIdD1(base, season, url);
  let paginas: PaginaTexto[];
  let perfil: LecturaPdf['perfil'];
  try {
    ({ paginas, perfil } = await extraerPaginas(bytes, { maxBytes: limites.maxBytes, maxPaginas: limites.maxPaginas,
      maxItemsPagina: 12_000, comprobar: limites.comprobar }));
  } catch (e) {
    if (e instanceof PdfNoLeible) throw new Error(`resultados_auto_pdf_no_leible:${e.message.slice(0, 80)}`);
    throw e;
  }
  const lectura: LecturaPdf = { ...leerResultadosPdf(paginas, { url, docId }), sha256: huella, perfil };
  const fechas: IndiceFechas = new Map([[`${season}|${url.split('#')[0]}`, filasCatalogo.map((f) => ({
    temporada: season, fecha: f.fecha, arma: f.arma, genero: f.genero, categoria: f.categoria, formato: f.formato,
  }))]]);
  const conv = lecturaAHechos(lectura, season, fechas);
  return {
    docId, lectura, textos: paginas.map(textoDePagina), hechos: conv.hechos, descartadas: conv.descartadas.length,
    motivosDescarte: conv.descartadas.map((x) => x.motivo.slice(0, 120)), ocr: lectura.ocr.necesario,
  };
}
