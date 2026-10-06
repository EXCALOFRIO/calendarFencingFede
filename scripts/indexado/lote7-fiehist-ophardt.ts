/**
 * Ophardt Online (fencing.ophardt.online) para las pruebas FIE individuales
 * anteriores a la temporada 2017: clasificaciones finales de las pruebas que la
 * base tiene vacías y documentación PDF enlazada en cada sección.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fiehist-ophardt.ts indice
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fiehist-ophardt.ts descargar [--db <sqlite>]
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fiehist-ophardt.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * `indice` recorre por semestres el listado público de resultados (1950-2016) y
 * guarda `ophardt-indice.json`. `descargar` pide la página de resultados de cada
 * torneo candidato de una prueba objetivo (misma ventana de fechas y título de
 * campeonato compatible). `hechos` trabaja sólo con la caché: una prueba FIE sin
 * puestos se casa con la única sección de arma, género, categoría y modalidad
 * iguales, y se escribe con las claves FIE existentes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { dividirPaginaPorPruebas } from '../../src/lib/ingest/sources/rfee-pdf/bloques';
import { leerCuadro } from '../../src/lib/ingest/sources/rfee-pdf/cuadro';
import { analizarPagina } from '../../src/lib/ingest/sources/rfee-pdf/paginas';
import { leerPoules } from '../../src/lib/ingest/sources/rfee-pdf/poules';
import type { PaginaTexto } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { consistenciaCuadro } from './cuadro-consistencia';
import { argumento } from './comun';
import { parsearListado, parsearResultados, urlResultados, type SeccionOphardt, type TorneoOphardt } from './fie-huecos-ophardt';
import { indicePersonasFie, resultadosIndividuales } from './fie-huecos-objetivos';
import { pdfsPorSeccion } from './fie-completar-ophardt';
import { puestosDeBase, type PuestoBase } from './fie-completar-comun';
import { solape } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import { extraerPaginas } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { CACHE_LOTE7, enCache, obtener, SALIDA_LOTE7, textoDe } from './lote7-fiehist-comun';
import { alinearNombres, leerDocumento, type LecturaDoc } from './lote7-fiehist-pdf';

export const DB_POR_DEFECTO = join(CACHE_LOTE7, '..', 'nuevo7.sqlite');
const INDICE = join(CACHE_LOTE7, 'ophardt-indice.json');
const INFORME = join(CACHE_LOTE7, 'ophardt-informe.json');
const INVENTARIO = join(CACHE_LOTE7, 'ophardt-inventario.json');
const BASE = 'https://fencing.ophardt.online';

// ---------------------------------------------------------------------------
// Pruebas objetivo de la base
// ---------------------------------------------------------------------------

export type PruebaHist = {
  id: string;
  season: string;
  competitionKey: string;
  weapon: HechosPrueba['competition']['weapon'];
  gender: HechosPrueba['competition']['gender'];
  category: HechosPrueba['competition']['category'];
  categoryRaw: string | null;
  format: HechosPrueba['competition']['format'];
  date: string | null;
  tournamentKey: string;
  editionName: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  countryCode: string | null;
  sourceUrl: string | null;
  resultados: number;
  espanoles: number;
  poule: number;
  tableau: number;
};

export function abrirBase(ruta: string): DatabaseSync {
  return new DatabaseSync(ruta, { readOnly: true });
}

/** Pruebas FIE individuales anteriores a la temporada 2017 ya celebradas, con sus recuentos. */
export function pruebasHistoricas(db: DatabaseSync): PruebaHist[] {
  const filas = db.prepare(`
    WITH c AS (
      SELECT c.*, e.tournament_key, e.name ename, e.start_date, e.end_date, e.city, e.country_code
        FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
       WHERE c.source = 'fie' AND c.format = 'INDIVIDUAL' AND CAST(c.season AS INTEGER) < 2017),
    r AS (SELECT competition_id, count(*) n, sum(source_country_code = 'ESP') esp FROM sport_result
           WHERE competition_id IN (SELECT id FROM c) GROUP BY 1),
    b AS (SELECT competition_id, sum(phase = 'POULE') p, sum(phase = 'TABLEAU') t
            FROM sport_bout WHERE competition_id IN (SELECT id FROM c) GROUP BY 1)
    SELECT c.id, c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.format,
           c.competition_date, c.source_url, c.tournament_key, c.ename, c.start_date, c.end_date, c.city, c.country_code,
           coalesce(r.n, 0) res, coalesce(r.esp, 0) esp, coalesce(b.p, 0) p, coalesce(b.t, 0) t
      FROM c LEFT JOIN r ON r.competition_id = c.id LEFT JOIN b ON b.competition_id = c.id
     ORDER BY CAST(c.season AS INTEGER), c.competition_key`).all() as Record<string, string | number | null>[];
  return filas.map((f) => ({
    id: String(f.id),
    season: String(f.season),
    competitionKey: String(f.competition_key),
    weapon: f.weapon as PruebaHist['weapon'],
    gender: f.gender as PruebaHist['gender'],
    category: f.category as PruebaHist['category'],
    categoryRaw: (f.category_raw as string | null) ?? null,
    format: f.format as PruebaHist['format'],
    date: (f.competition_date as string | null) ?? null,
    tournamentKey: String(f.tournament_key),
    editionName: String(f.ename),
    startDate: (f.start_date as string | null) ?? null,
    endDate: (f.end_date as string | null) ?? null,
    city: (f.city as string | null) ?? null,
    countryCode: (f.country_code as string | null) ?? null,
    sourceUrl: (f.source_url as string | null) ?? null,
    resultados: Number(f.res),
    espanoles: Number(f.esp),
    poule: Number(f.p),
    tableau: Number(f.t),
  }));
}

export const fechaPrueba = (p: Pick<PruebaHist, 'date' | 'startDate'>): string | null => p.date ?? p.startDate;

const PAIS = /^[A-Z]{3}$/;

/** Cabecera de hechos con las claves de la fila FIE existente, para que el cargador la complete. */
export function cabeceraHist(p: PruebaHist): Pick<HechosPrueba, 'version' | 'source' | 'edition' | 'competition'> {
  return {
    version: 1,
    source: 'fie',
    edition: {
      season: p.season, tournamentKey: p.tournamentKey, name: p.editionName, startDate: p.startDate, endDate: p.endDate,
      city: p.city, countryCode: p.countryCode && PAIS.test(p.countryCode) ? p.countryCode : null,
    },
    competition: {
      competitionKey: p.competitionKey, weapon: p.weapon, gender: p.gender, category: p.category,
      categoryRaw: p.categoryRaw, format: p.format, date: p.date,
    },
  };
}

// ---------------------------------------------------------------------------
// Grupos de campeonato y su título en Ophardt
// ---------------------------------------------------------------------------

const plano = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Grupo de la edición FIE y patrón de título en Ophardt; null = sin correspondencia fiable. */
export function grupoHist(nombre: string, categoria: string): { grupo: string; titulo: RegExp; mismoPais: boolean } | null {
  const n = plano(nombre);
  const mundial = /World.*Champ|Championnats? du Monde|Weltmeister/i;
  if (/jeux olympiques de la jeunesse|joj|youth olympic/.test(n)) return { grupo: 'JOJ', titulo: /Youth Olympic|YOG|JOJ/i, mismoPais: false };
  if (/olympi/.test(n) && !/qualif/.test(n)) return { grupo: 'Juegos Olímpicos', titulo: /Olympic|Olympia|Jeux Olymp/i, mismoPais: false };
  if (/champ.* du monde|championnats du monde|world champ/.test(n)) {
    return { grupo: categoria === 'VET' ? 'Mundiales veteranos' : categoria === 'ABS' ? 'Mundiales' : 'Mundiales júnior-cadete', titulo: mundial, mismoPais: false };
  }
  if (/universiade|fisu/.test(n)) return { grupo: 'Universiadas', titulo: /Universi|FISU/i, mismoPais: false };
  if (/europe|european/.test(n)) return { grupo: 'Europeos', titulo: /Europ/i, mismoPais: false };
  if (/asiati|asian/.test(n)) return { grupo: 'Asiáticos', titulo: /Asia/i, mismoPais: false };
  if (/panameri|pan american/.test(n)) return { grupo: 'Panamericanos', titulo: /Pan.?Americ|Panameric/i, mismoPais: false };
  if (/sudameri|south american|sudamericanos/.test(n)) return { grupo: 'Sudamericanos', titulo: /South.?Americ|Sudameric|Suramer/i, mismoPais: false };
  if (/centram|central americ|caraibes|caribe/.test(n)) return { grupo: 'Centroamericanos', titulo: /Central.?Americ|Centroameric|Carib/i, mismoPais: false };
  if (/afrique|african|africains/.test(n)) return { grupo: 'Africanos', titulo: /Afri/i, mismoPais: false };
  if (/mediterran|méditerran/.test(n)) return { grupo: 'Mediterráneos', titulo: /Mediterr/i, mismoPais: false };
  if (/commonwealth/.test(n)) return { grupo: 'Commonwealth', titulo: /Commonwealth/i, mismoPais: false };
  if (/south east asian|sea games/.test(n)) return { grupo: 'SEA Games', titulo: /SEA Games|South ?East/i, mismoPais: false };
  if (/arabophone|arab/.test(n)) return { grupo: 'Juegos Árabes', titulo: /Arab/i, mismoPais: false };
  if (/qualif/.test(n)) return { grupo: 'Clasificatorios olímpicos', titulo: /Qualif/i, mismoPais: false };
  if (/combat games/.test(n)) return { grupo: 'World Combat Games', titulo: /Combat/i, mismoPais: false };
  if (/grand prix|coupe du monde|world cup|satellite|challenge|trophee|tournoi|cup|coupe|memorial|trophy|pokal|preis/.test(n)) {
    return { grupo: 'Copas del Mundo y satélites', titulo: /./, mismoPais: true };
  }
  return { grupo: 'Otros', titulo: /./, mismoPais: true };
}

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

const urlListado = (desde: string, hasta: string, pagina: number) =>
  `${BASE}/en/search/results?date-from=${desde}&date-to=${hasta}&sort=v.dateStart&direction=asc&page=${pagina}`;

async function indice() {
  const todos = new Map<string, TorneoOphardt>();
  for (let ano = 1950; ano <= 2016; ano += 1) {
    for (const [desde, hasta] of [[`${ano}-01-01`, `${ano}-06-30`], [`${ano}-07-01`, `${ano}-12-31`]]) {
      for (let p = 1, max = 1; p <= max && p <= 60; p += 1) {
        const d = await obtener(urlListado(desde, hasta, p));
        const html = textoDe(d);
        if (!html) break;
        const r = parsearListado(html);
        for (const t of r.torneos) todos.set(t.id, t);
        max = r.paginas;
      }
    }
    console.log(`${ano}: ${todos.size} torneos acumulados`);
  }
  writeFileSync(INDICE, `${JSON.stringify([...todos.values()], null, 0)}\n`);
  console.log(`${todos.size} torneos en ${INDICE}`);
}

function leerIndice(): TorneoOphardt[] {
  if (!existsSync(INDICE)) throw new Error(`falta ${INDICE}: ejecuta antes «indice»`);
  return JSON.parse(readFileSync(INDICE, 'utf8')) as TorneoOphardt[];
}

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);

/** Torneos de Ophardt compatibles con la prueba: fecha cercana, título del campeonato y, en circuito, el país sede. */
export function candidatos(p: PruebaHist, torneos: readonly TorneoOphardt[]): TorneoOphardt[] {
  const f = fechaPrueba(p);
  if (!f) return [];
  const g = grupoHist(p.editionName, p.category);
  if (!g) return [];
  const centro = dia(f);
  // Las fechas antiguas de la FIE son a veces sólo el año o el primer día del campeonato.
  const antes = Number(p.season) < 2003 ? 120 : 8;
  const despues = Number(p.season) < 2003 ? 240 : 8;
  return torneos.filter((t) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.desde)) return false;
    const d = dia(t.desde) - centro;
    if (d < -antes || d > despues) return false;
    if (g.mismoPais) return !!p.countryCode && t.nacion === p.countryCode;
    return g.titulo.test(t.titulo);
  });
}

export type Seleccion = { prueba: PruebaHist; torneos: TorneoOphardt[] };

/** Pruebas celebradas sin puestos o sin ningún asalto, con sus torneos candidatos de Ophardt. */
export function objetivos(db: DatabaseSync, torneos: readonly TorneoOphardt[], hoy = new Date().toISOString().slice(0, 10)): Seleccion[] {
  return pruebasHistoricas(db)
    .filter((p) => {
      const f = fechaPrueba(p);
      return !!f && f < hoy && (p.resultados === 0 || p.poule + p.tableau === 0);
    })
    .map((p) => ({ prueba: p, torneos: candidatos(p, torneos) }));
}

// ---------------------------------------------------------------------------
// Emparejamiento
// ---------------------------------------------------------------------------

export type Candidato = { torneo: TorneoOphardt; secciones: SeccionOphardt[]; url: string; sha256: string; html: string };

const seccionCasa = (s: SeccionOphardt, p: PruebaHist) =>
  s.weapon === p.weapon && s.gender === p.gender && s.category === p.category &&
  (s.format === p.format || (s.format === null && p.format === 'INDIVIDUAL')) && s.individuales.length > 0;

export type Asignacion = { ok: true; c: Candidato; s: SeccionOphardt; solape: number | null } | { ok: false; motivo: string };

/**
 * La única sección compatible de los torneos candidatos. Si la prueba ya tiene
 * clasificación, además debe compartir al menos la mitad de los tiradores (nombre
 * y nación) y sacar 15 puntos a la siguiente.
 */
export function asignar(p: PruebaHist, cands: Candidato[], puestos: readonly PuestoBase[]): Asignacion {
  const casan = cands.flatMap((c) => c.secciones.filter((s) => seccionCasa(s, p)).map((s) => ({ c, s })));
  if (casan.length === 0) return { ok: false, motivo: cands.length ? 'ninguna_seccion_casa' : 'sin_torneo_ophardt' };
  if (puestos.length > 0) {
    const orden = casan
      .map((x) => ({ ...x, v: solape(puestos, x.s.individuales.map((f) => ({ nombre: f.name, pais: f.countryCode }))) }))
      .sort((a, b) => b.v - a.v);
    const [m, sig] = orden;
    if (m.v < 0.5 || (sig && sig.v >= m.v - 0.15)) return { ok: false, motivo: `solape_insuficiente:${m.v.toFixed(2)}` };
    return { ok: true, c: m.c, s: m.s, solape: m.v };
  }
  if (casan.length === 1) return { ok: true, c: casan[0].c, s: casan[0].s, solape: null };
  const mismoPais = casan.filter((x) => x.c.torneo.nacion === p.countryCode);
  if (mismoPais.length === 1) return { ok: true, c: mismoPais[0].c, s: mismoPais[0].s, solape: null };
  return { ok: false, motivo: `ambigua:${casan.map((x) => `${x.c.torneo.id}/${x.s.titulo}`).join(',')}` };
}

function cargarCandidatos(ts: readonly TorneoOphardt[]): Candidato[] {
  const out: Candidato[] = [];
  for (const t of ts) {
    const url = urlResultados(t.id);
    const d = enCache(url);
    const html = textoDe(d);
    if (!html || !d?.sha256) continue;
    out.push({ torneo: t, secciones: parsearResultados(html), url, sha256: d.sha256, html });
  }
  return out;
}

/** PDF de documentación de la sección o, si no lo hay, los del torneo. */
export function enlacesPdf(html: string, seccion: string): string[] {
  const propio = pdfsPorSeccion(html).get(seccion.replace(/\s+/g, ' ').trim());
  if (propio) return [propio];
  const todos = [...html.matchAll(/href="([^"]*\/cdn\/documents\/documentation\/[^"]+\.pdf)"/gi)]
    .map((m) => new URL(m[1].replace('/documentation/../', '/'), BASE).href);
  return [...new Set(todos)].filter((u) => !/legacy-documentation/.test(u));
}

type Asignada = { p: PruebaHist; a: Asignacion; puestos: PuestoBase[] };

function asignarTodas(db: DatabaseSync, sel: Seleccion[]): Asignada[] {
  const out = sel.map((s) => {
    const puestos = s.prueba.resultados > 0 ? puestosDeBase(db, s.prueba.id) : [];
    return { p: s.prueba, a: asignar(s.prueba, cargarCandidatos(s.torneos), puestos), puestos };
  });
  // Una sección no puede ser la clasificación de dos pruebas FIE distintas.
  const veces = new Map<string, number>();
  for (const x of out) if (x.a.ok) veces.set(`${x.a.c.torneo.id}|${x.a.s.titulo}`, (veces.get(`${x.a.c.torneo.id}|${x.a.s.titulo}`) ?? 0) + 1);
  return out.map((x) => (x.a.ok && (veces.get(`${x.a.c.torneo.id}|${x.a.s.titulo}`) ?? 0) > 1
    ? { ...x, a: { ok: false as const, motivo: `seccion_compartida:${x.a.c.torneo.id}/${x.a.s.titulo}` } }
    : x));
}

// ---------------------------------------------------------------------------
// Lectura de la documentación PDF
// ---------------------------------------------------------------------------

export type FormatoPdf = 'ophardt' | 'engarde' | 'otro' | 'escaneado';

type LecturaEngarde = {
  bouts: AsaltoHecho[];
  pools: { leidos: number; publicado: number; fuera: number } | null;
  tableau: { leidos: number; publicado: number; fuera: number; incoherentes: number } | null;
};

export type ResultadoPdf = {
  url: string; sha: string; paginas: number; conTexto: number; formato: FormatoPdf;
  ophardt: LecturaDoc | null; engarde: LecturaEngarde | null;
};

export function formatoPdf(paginas: PaginaTexto[]): FormatoPdf {
  const texto = paginas.slice(0, 3).flatMap((p) => p.items.map((i) => i.s)).join(' ');
  if (!texto.trim()) return 'escaneado';
  if (/RESULTS:\s*LIST OF RESULTS/i.test(texto)) return 'ophardt';
  if (/en ?garde/i.test(texto)) return 'engarde';
  return 'otro';
}

/**
 * Documentos de Engarde subidos por el organizador: los lectores de poules y cuadro del
 * PDF Engarde de la RFEE, con la clasificación de la prueba como registro (cada nombre se
 * atribuye a un `factKey`; lo que no se atribuye a una sola fila queda fuera).
 */
export function leerEngardePdf(paginas: PaginaTexto[], results: HechosPrueba['results']): LecturaEngarde {
  const analizadas = paginas.flatMap(dividirPaginaPorPruebas).map(analizarPagina);
  const registro = results.map((r) => ({ ref: r.factKey, nombre: r.name, club: null, pais: r.countryCode }));
  const nombres = new Map(results.map((r) => [r.factKey, r.name]));
  const po = analizadas.some((a) => a.tipo === 'poules') ? leerPoules(analizadas.filter((a) => a.tipo === 'poules'), registro) : null;
  const cu = analizadas.some((a) => a.tipo === 'cuadro') ? leerCuadro(analizadas.filter((a) => a.tipo === 'cuadro'), registro) : null;
  const convertir = (a: NonNullable<typeof po>['asaltos'][number]): AsaltoHecho => ({
    phase: a.fase, roundKey: a.ronda, aRef: a.refA, bRef: a.refB, aName: nombres.get(a.refA) ?? a.nombreA,
    bName: nombres.get(a.refB) ?? a.nombreB, scoreA: a.puntosA, scoreB: a.puntosB, winner: null,
  });
  const validos = (l: typeof po | typeof cu) => (l?.asaltos ?? []).map(convertir)
    .filter((b) => b.aRef !== b.bRef && b.scoreA !== b.scoreB && Math.max(b.scoreA, b.scoreB) <= 45);
  const fuera = (l: typeof po | typeof cu) => (l ? Object.entries(l.excluidos).reduce((s, [k, v]) => (k === 'bye' || k === 'duplicado' ? s : s + v), 0) + l.rechazos.length : 0);
  const pb = validos(po).filter((b) => b.phase === 'POULE' && Math.max(b.scoreA, b.scoreB) <= 5);
  let cb = validos(cu).filter((b) => b.phase === 'TABLEAU');
  const c = consistenciaCuadro(cb);
  cb = cb.filter((_, i) => !c.incoherentes.has(i));
  return {
    bouts: [...pb, ...cb],
    pools: po ? { leidos: pb.length, publicado: po.publicado, fuera: fuera(po) } : null,
    tableau: cu ? { leidos: cb.length, publicado: cu.publicado, fuera: fuera(cu), incoherentes: c.incoherentes.size } : null,
  };
}

async function leerPdf(url: string, p: PruebaHist, results: HechosPrueba['results'], red: boolean): Promise<ResultadoPdf | { motivo: string; status?: number }> {
  const d = red ? await obtener(url) : enCache(url);
  if (!d || d.status !== 200 || !d.bytes) return { motivo: 'pdf_no_disponible', status: d?.status };
  try {
    const { paginas } = await extraerPaginas(d.bytes, { maxPaginas: 600 });
    const formato = formatoPdf(paginas);
    const conTexto = paginas.filter((x) => x.items.some((i) => i.s.trim())).length;
    const base = { url, sha: d.sha256!, paginas: paginas.length, conTexto, formato };
    if (formato === 'escaneado') return { ...base, ophardt: null, engarde: null };
    // El lector propio cubre los dos formatos que genera el sistema de Ophardt; el de Engarde, el resto.
    const ophardt = leerDocumento(paginas, p);
    if (ophardt.poules?.bouts.length || ophardt.cuadro?.bouts.length || results.length === 0) return { ...base, ophardt, engarde: null };
    return { ...base, ophardt: null, engarde: leerEngardePdf(paginas, results) };
  } catch (e) {
    return { motivo: `pdf_ilegible:${(e as Error).message.slice(0, 60)}` };
  }
}

// ---------------------------------------------------------------------------
// Descarga e inventario
// ---------------------------------------------------------------------------

async function descargar() {
  const db = abrirBase(argumento('db', DB_POR_DEFECTO));
  const sel = objetivos(db, leerIndice());
  const ids = [...new Set(sel.flatMap((s) => s.torneos.map((t) => t.id)))];
  console.log(`${sel.length} pruebas objetivo (${sel.filter((s) => s.prueba.resultados === 0).length} sin puestos); ${sel.filter((s) => s.torneos.length).length} con candidatos; ${ids.length} torneos`);
  let n = 0;
  for (const id of ids) {
    const d = await obtener(urlResultados(id));
    n += 1;
    if (n % 100 === 0 || d.status !== 200) console.log(`  torneo ${n}/${ids.length} ${id} HTTP ${d.status}`);
  }
  const asignadas = asignarTodas(db, sel);
  db.close();
  const urls = [...new Set(asignadas.flatMap(({ a }) => (a.ok ? enlacesPdf(a.c.html, a.s.titulo).slice(0, 3) : [])))];
  console.log(`${asignadas.filter((x) => x.a.ok).length} pruebas casadas con Ophardt; ${urls.length} PDF`);
  n = 0;
  for (const url of urls) {
    const d = await obtener(url);
    n += 1;
    if (n % 100 === 0 || d.status !== 200) console.log(`  pdf ${n}/${urls.length} HTTP ${d.status}`);
  }
}

/** Resultados base de la prueba: la clasificación FIE guardada o, si no hay, la de la sección de Ophardt. */
function resultadosDe(x: Asignada, indicePersonas: ReturnType<typeof indicePersonasFie>): { results: HechosPrueba['results']; vinculados: number } {
  if (x.p.resultados > 0) {
    return {
      vinculados: 0,
      results: x.puestos.map((r) => ({
        factKey: r.factKey, name: r.name, countryCode: r.countryCode && PAIS.test(r.countryCode) ? r.countryCode : null,
        club: null, position: r.position, positionRaw: null, points: null, fieId: null, license: null, birthYear: null,
      })),
    };
  }
  if (!x.a.ok) return { results: [], vinculados: 0 };
  const r = resultadosIndividuales(x.a.s.individuales, x.p.gender, indicePersonas);
  return { results: r.results, vinculados: r.vinculados };
}

async function inventario() {
  const db = abrirBase(argumento('db', DB_POR_DEFECTO));
  const asignadas = asignarTodas(db, objetivos(db, leerIndice()));
  const indicePersonas = indicePersonasFie(db);
  db.close();
  const filas: Record<string, unknown>[] = [];
  for (const x of asignadas) {
    const { p, a } = x;
    const base = {
      season: p.season, competitionKey: p.competitionKey, edicion: p.editionName, categoria: p.category, fecha: fechaPrueba(p),
      resultadosBase: p.resultados, espanoles: p.espanoles,
    };
    if (!a.ok) {
      filas.push({ ...base, motivo: a.motivo });
      continue;
    }
    const pdfs = enlacesPdf(a.c.html, a.s.titulo).slice(0, 3);
    const fila: Record<string, unknown> = { ...base, torneo: a.c.torneo.id, seccion: a.s.titulo, solape: a.solape, puestosOphardt: a.s.individuales.length, pdfs: pdfs.length };
    const { results } = resultadosDe(x, indicePersonas);
    const lecturas = [];
    for (const url of pdfs) {
      const l = await leerPdf(url, p, results, false);
      if ('motivo' in l) lecturas.push({ url, motivo: l.motivo });
      else {
        lecturas.push({
          url, formato: l.formato, paginas: l.paginas, conTexto: l.conTexto,
          poules: l.ophardt?.poules?.bouts.length ?? l.engarde?.pools?.leidos ?? 0,
          poulesEsperados: l.ophardt?.poules?.esperados ?? l.engarde?.pools?.publicado ?? 0,
          cuadro: l.ophardt?.cuadro?.bouts.length ?? l.engarde?.tableau?.leidos ?? 0,
          cuadroEsperados: l.ophardt?.cuadro?.esperados ?? l.engarde?.tableau?.publicado ?? 0,
        });
      }
    }
    filas.push({ ...fila, lecturas });
  }
  writeFileSync(INVENTARIO, `${JSON.stringify(filas, null, 1)}\n`);
  console.log(`inventario de ${filas.length} pruebas en ${INVENTARIO}`);
}

// ---------------------------------------------------------------------------
// Hechos
// ---------------------------------------------------------------------------

type Estado = HechosPrueba['status']['pools'];

function estadoFase(leidos: number, publicado: number, fuera: number): Estado {
  if (leidos === 0) return 'parcial';
  return fuera === 0 && leidos >= publicado ? 'completo' : 'parcial';
}

async function hechos() {
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  const db = abrirBase(argumento('db', DB_POR_DEFECTO));
  const asignadas = asignarTodas(db, objetivos(db, leerIndice()));
  const indicePersonas = indicePersonasFie(db);
  db.close();
  const informe: Record<string, unknown>[] = [];
  let escritos = 0;
  for (const x of asignadas) {
    const { p, a, puestos } = x;
    const base = {
      season: p.season, competitionKey: p.competitionKey, edicion: p.editionName, fecha: fechaPrueba(p), categoria: p.category,
      resultadosBase: p.resultados,
    };
    if (!a.ok) {
      informe.push({ ...base, motivo: a.motivo });
      continue;
    }
    const conPuestos = p.resultados > 0;
    const notas: string[] = [];
    const { results, vinculados } = resultadosDe(x, indicePersonas);
    let estadoResultados: HechosPrueba['status']['results'] = 'parcial';
    if (!conPuestos) {
      const ultimo = Math.max(0, ...results.map((r) => r.position ?? 0));
      estadoResultados = ultimo <= results.length && results.length > 0 ? 'completo' : 'parcial';
      notas.push(
        `Clasificación final publicada en Ophardt Online, torneo ${a.c.torneo.id} «${a.c.torneo.titulo}» (${a.c.torneo.nacion} ${a.c.torneo.ciudad}, ${a.c.torneo.desde}), sección «${a.s.titulo}»; la FIE sólo publica los datos de la prueba`,
        `${vinculados} de ${results.length} puestos con factKey = ID FIE de la única persona FIE con el mismo nombre, nación y género (vínculo por nombre; fieId vacío porque Ophardt no lo publica); el resto, ophardt:<ficha>`,
      );
      if (estadoResultados !== 'completo') notas.push(`Clasificación incompleta: último puesto ${ultimo} con ${results.length} filas publicadas`);
    }
    let h = hechosPrueba.parse({
      ...cabeceraHist(p),
      extractor: 'ophardt_resultados',
      sourceUrl: a.c.url,
      sourceSha256: a.c.sha256,
      // Sin la fase en la fuente no se sabe si la prueba la tuvo: `parcial` con 0 asaltos, que el
      // cargador se salta, en lugar de `sin_resultados`, que afirmaría que no la hubo.
      status: { results: estadoResultados, pools: 'parcial', tableau: 'parcial', publishedParticipants: conPuestos ? null : results.length, notes: notas },
      results,
      bouts: [],
    });
    let resumen: Record<string, unknown> = {};
    // Cada PDF puede traer sólo una fase: se toma, por fase, la lectura con más asaltos válidos.
    type Lect = { url: string; sha: string; formato: string; lector: 'ophardt_pdf' | 'ophardt_pdf_engarde'; bouts: AsaltoHecho[]; pools: Estado; tableau: Estado; nota: string; resumen: Record<string, unknown> };
    const lecturas: Lect[] = [];
    for (const url of enlacesPdf(a.c.html, a.s.titulo).slice(0, 3)) {
      const l = await leerPdf(url, p, results, false);
      if ('motivo' in l) continue;
      if (l.ophardt && (l.ophardt.poules?.bouts.length || l.ophardt.cuadro?.bouts.length)) {
        alinearNombres(l.ophardt, results.map((x) => ({ nombre: x.name, pais: x.countryCode })));
        const r = anadirAsaltos(h, { arma: null, genero: null, puestos: l.ophardt.puestos, poules: l.ophardt.poules, cuadro: l.ophardt.cuadro }, {
          nombre: 'ophardt_pdf', url, descripcion: 'poules y cuadro de la documentación PDF que Ophardt Online publica de la prueba',
        });
        lecturas.push({
          url, sha: l.sha, formato: l.formato, lector: 'ophardt_pdf', bouts: r.hechos.bouts, pools: r.hechos.status.pools, tableau: r.hechos.status.tableau,
          nota: r.hechos.status.notes[r.hechos.status.notes.length - 1],
          resumen: { pools: r.informe.pools, tableau: r.informe.tableau, sinCasar: r.informe.tiradores.sinCasar.length },
        });
      } else if (l.engarde && l.engarde.bouts.length) {
        const e = l.engarde;
        const nP = e.bouts.filter((b) => b.phase === 'POULE').length;
        const nT = e.bouts.filter((b) => b.phase === 'TABLEAU').length;
        lecturas.push({
          url, sha: l.sha, formato: l.formato, lector: 'ophardt_pdf_engarde', bouts: e.bouts,
          pools: e.pools ? estadoFase(nP, e.pools.publicado, e.pools.fuera) : 'parcial',
          tableau: e.tableau ? estadoFase(nT, e.tableau.publicado, e.tableau.fuera + e.tableau.incoherentes) : 'parcial',
          nota: `Asaltos: documento Engarde que el organizador publicó en Ophardt Online (${url}), leído con el lector de PDF Engarde; nombres atribuidos a la clasificación de la prueba; poules ${nP} de ${e.pools?.publicado ?? 0}, cuadro ${nT} de ${e.tableau?.publicado ?? 0}${e.tableau?.incoherentes ? ` (${e.tableau.incoherentes} cruces incoherentes fuera)` : ''}; no se importan asaltos de equipos`,
          resumen: { pools: e.pools, tableau: e.tableau },
        });
      }
    }
    // Poules a 5 y eliminación directa a 15: un marcador mayor es una mala lectura del PDF.
    const fase = (x: Lect, f: 'POULE' | 'TABLEAU') => x.bouts.filter((b) => b.phase === f && Math.max(b.scoreA, b.scoreB) <= (f === 'POULE' ? 5 : 15));
    const mejor = (f: 'POULE' | 'TABLEAU') => lecturas.filter((x) => fase(x, f).length > 0).sort((x, y) => fase(y, f).length - fase(x, f).length)[0];
    const lp = mejor('POULE');
    const lt = mejor('TABLEAU');
    if (lp || lt) {
      const fuera = (x: Lect | undefined, f: 'POULE' | 'TABLEAU') => (x ? x.bouts.filter((b) => b.phase === f).length - fase(x, f).length : 0);
      const principal = [lp, lt].filter((x): x is Lect => !!x).sort((x, y) => y.bouts.length - x.bouts.length)[0];
      const notas2 = [...h.status.notes, ...new Set([lp?.nota, lt?.nota].filter((n): n is string => !!n))];
      if (fuera(lp, 'POULE') + fuera(lt, 'TABLEAU') > 0) notas2.push(`${fuera(lp, 'POULE') + fuera(lt, 'TABLEAU')} asaltos con marcador imposible (poule > 5, cuadro > 15) descartados`);
      h = hechosPrueba.parse({
        ...h,
        extractor: principal.lector,
        ...(conPuestos ? { sourceUrl: principal.url, sourceSha256: principal.sha } : {}),
        status: {
          ...h.status,
          pools: lp ? (fuera(lp, 'POULE') ? 'parcial' : lp.pools) : 'parcial',
          tableau: lt ? (fuera(lt, 'TABLEAU') ? 'parcial' : lt.tableau) : 'parcial',
          notes: notas2,
        },
        bouts: [...(lp ? fase(lp, 'POULE') : []), ...(lt ? fase(lt, 'TABLEAU') : [])],
      });
      resumen = { pdfPoules: lp?.url, pdfCuadro: lt?.url, formato: principal.formato, pools: lp?.resumen.pools, tableau: lt?.resumen.tableau };
    }
    const pdfs = enlacesPdf(a.c.html, a.s.titulo);
    if (conPuestos) {
      if (h.bouts.length === 0) {
        informe.push({ ...base, torneo: a.c.torneo.id, seccion: a.s.titulo, motivo: pdfs.length ? 'pdf_sin_asaltos' : 'sin_pdf' });
        continue;
      }
      // Los puestos FIE guardados no se tocan: sólo sirven para dar referencias a los asaltos.
      h = hechosPrueba.parse({
        ...h,
        results: [],
        status: {
          ...h.status, results: 'parcial',
          notes: [...h.status.notes, `Torneo Ophardt ${a.c.torneo.id} «${a.c.torneo.titulo}», sección «${a.s.titulo}», casado por clasificación (${Math.round((a.solape ?? 0) * 100)} % de la clasificación FIE guardada); los puestos no se tocan`],
        },
      });
    }
    writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
    escritos += 1;
    informe.push({
      ...base, torneo: a.c.torneo.id, seccion: a.s.titulo, solape: a.solape, puestos: conPuestos ? 0 : results.length, vinculados,
      espanoles: (conPuestos ? puestos : results).filter((r) => r.countryCode === 'ESP').length,
      estadoResultados: h.status.results, poules: h.bouts.filter((b) => b.phase === 'POULE').length,
      cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length, estadoPoules: h.status.pools, estadoCuadro: h.status.tableau, ...resumen,
    });
  }
  writeFileSync(INFORME, `${JSON.stringify(informe, null, 1)}\n`);
  const motivos: Record<string, number> = {};
  for (const i of informe) {
    const m = String(i.motivo ?? 'escrito').replace(/:.*/, '');
    motivos[m] = (motivos[m] ?? 0) + 1;
  }
  console.log(`${escritos} ficheros de hechos en ${salida}; informe en ${INFORME}`, motivos);
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'indice') await indice();
  else if (orden === 'descargar') await descargar();
  else if (orden === 'inventario') await inventario();
  else if (orden === 'hechos') await hechos();
  else throw new Error('uso: lote7-fiehist-ophardt.ts indice|descargar|inventario|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
