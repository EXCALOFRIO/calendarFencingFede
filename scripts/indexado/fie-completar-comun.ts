import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { CARPETA_TRABAJO } from './comun';

/**
 * Rutas, caché y consultas compartidas por los `fie-completar-*`: auditoría de
 * completitud de asaltos de las pruebas FIE individuales (2017+) y recuperación
 * de los que faltan.
 */

export const CACHE = join(CARPETA_TRABAJO, 'cache-fie-completar');
export const CACHE_FIE = join(CACHE, 'fie');
export const SALIDA_HECHOS = join(CARPETA_TRABAJO, 'hechos', 'fie-completar');
export const INFORME_COMPLETITUD = join(CARPETA_TRABAJO, 'fie-completitud.json');
/** Copia exacta de producción: sólo lectura. */
export const BASE_PRODUCCION = join(CARPETA_TRABAJO, 'nuevo5.sqlite');
/** Lecturas FIE anteriores (mismo formato de fichero) que se reutilizan sin pedirlas otra vez. */
export const CACHES_FIE_PREVIAS = [
  join(CARPETA_TRABAJO, 'fie-huecos', 'fie-relectura', 'raw'),
  join(CARPETA_TRABAJO, 'fie-dirigido', 'raw'),
];

export const USER_AGENT = process.env.INGEST_USER_AGENT ||
  'CalendarioEsgrima/1.0 (+https://calendario-fie-fede.excalofrio.workers.dev)';

export const sha256 = (datos: Uint8Array | string): string => createHash('sha256').update(datos).digest('hex');

export type ParteFie = 'meta' | 'pools' | 'tableau';

export function ficheroFie(season: string | number, competitionId: string | number, parte: ParteFie): string {
  return `${season}-${competitionId}-${parte}.json`;
}

/** JSON FIE cacheado (propio o de una lectura anterior); null si no está. */
export function leerFieCache(season: string | number, id: string | number, parte: ParteFie): { cuerpo: unknown; sha: string; ruta: string } | null {
  for (const dir of [CACHE_FIE, ...CACHES_FIE_PREVIAS]) {
    const ruta = join(dir, ficheroFie(season, id, parte));
    if (!existsSync(ruta)) continue;
    const bytes = readFileSync(ruta);
    try {
      return { cuerpo: JSON.parse(bytes.toString('utf8')), sha: sha256(bytes), ruta };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Red con caché para fuentes no FIE (Ophardt, FencingTimeLive, Engarde, Wayback)
// ---------------------------------------------------------------------------

const CACHE_WEB = join(CACHE, 'web');
const REGISTRO_WEB = join(CACHE_WEB, '_registro.jsonl');
type Registro = { url: string; status: number; fichero: string | null; sha256: string | null; bytes: number; ts: string };
let registro: Map<string, Registro> | null = null;

function cargarRegistro(): Map<string, Registro> {
  if (registro) return registro;
  registro = new Map();
  if (existsSync(REGISTRO_WEB)) {
    for (const l of readFileSync(REGISTRO_WEB, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l) as Registro;
        registro.set(r.url, r);
      } catch {
        /* línea truncada por una parada brusca */
      }
    }
  }
  return registro;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ultimoPorHost = new Map<string, number>();
const intervalo = (host: string) => (host.endsWith('archive.org') ? 1500 : 400);

export type Documento = { url: string; status: number; bytes: Uint8Array | null; sha256: string | null };

/** Documento de la caché o de la red. 404/410 se registran y no se piden otra vez. */
export async function obtenerWeb(url: string, opciones: { intentos?: number; refrescar?: boolean } = {}): Promise<Documento> {
  const reg = cargarRegistro();
  const previo = reg.get(url);
  if (previo && !opciones.refrescar && [200, 404, 410].includes(previo.status)) {
    if (!previo.fichero) return { url, status: previo.status, bytes: null, sha256: null };
    const bytes = new Uint8Array(readFileSync(join(CACHE_WEB, previo.fichero)));
    return { url, status: previo.status, bytes, sha256: sha256(bytes) };
  }
  const host = new URL(url).hostname;
  let espera = 4000;
  const max = opciones.intentos ?? 5;
  for (let intento = 1; ; intento += 1) {
    const hueco = (ultimoPorHost.get(host) ?? 0) + intervalo(host) - Date.now();
    ultimoPorHost.set(host, Math.max(Date.now(), (ultimoPorHost.get(host) ?? 0) + intervalo(host)));
    if (hueco > 0) await dormir(hueco);
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(90_000) });
    } catch {
      if (intento >= max) return { url, status: -1, bytes: null, sha256: null };
      await dormir(espera);
      espera = Math.min(espera * 2, 60_000);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel();
      if (intento >= max) return { url, status: res.status, bytes: null, sha256: null };
      await dormir(espera);
      espera = Math.min(espera * 2, 60_000);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ok = res.status === 200;
    const h = sha256(url).slice(0, 24);
    const fichero = ok ? join(host.replace(/[^a-z0-9.-]+/gi, '_'), h.slice(0, 2), `${h}.bin`) : null;
    if (fichero) {
      const ruta = join(CACHE_WEB, fichero);
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(`${ruta}.tmp`, bytes);
      renameSync(`${ruta}.tmp`, ruta);
    }
    const r: Registro = { url, status: res.status, fichero, sha256: ok ? sha256(bytes) : null, bytes: bytes.length, ts: new Date().toISOString() };
    mkdirSync(CACHE_WEB, { recursive: true });
    appendFileSync(REGISTRO_WEB, `${JSON.stringify(r)}\n`);
    reg.set(url, r);
    return { url, status: res.status, bytes: ok ? bytes : null, sha256: r.sha256 };
  }
}

/** Sólo caché, para el paso a hechos sin red. */
export function webEnCache(url: string): Documento | null {
  const r = cargarRegistro().get(url);
  if (!r || r.status !== 200 || !r.fichero) return null;
  const bytes = new Uint8Array(readFileSync(join(CACHE_WEB, r.fichero)));
  return { url, status: 200, bytes, sha256: sha256(bytes) };
}

export const textoDe = (d: Documento | null): string | null => (d?.bytes ? new TextDecoder('utf-8').decode(d.bytes) : null);

/** Ejecuta `tarea` sobre `elementos` con como mucho `n` en vuelo. */
export async function enParalelo<T>(elementos: readonly T[], n: number, tarea: (x: T, i: number) => Promise<void>): Promise<void> {
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++;
      await tarea(elementos[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, n)) }, trabajador));
}

// ---------------------------------------------------------------------------
// Pruebas FIE individuales de la base
// ---------------------------------------------------------------------------

export type PruebaBase = {
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
  poule: number;
  tableau: number;
  coberturaPools: string | null;
  coberturaTableau: string | null;
};

export function abrirBase(ruta = BASE_PRODUCCION): DatabaseSync {
  return new DatabaseSync(ruta, { readOnly: true });
}

/** Pruebas FIE individuales desde 2017, con sus recuentos de puestos y asaltos por fase. */
export function pruebasFieIndividuales(db: DatabaseSync, desde = 2017): PruebaBase[] {
  const filas = db.prepare(`
    WITH c AS (
      SELECT c.*, e.tournament_key, e.name ename, e.start_date, e.end_date, e.city, e.country_code
        FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
       WHERE c.source = 'fie' AND c.format = 'INDIVIDUAL' AND CAST(c.season AS INTEGER) >= ?),
    r AS (SELECT competition_id, count(*) n FROM sport_result WHERE competition_id IN (SELECT id FROM c) GROUP BY 1),
    b AS (SELECT competition_id, sum(phase = 'POULE') p, sum(phase = 'TABLEAU') t
            FROM sport_bout WHERE competition_id IN (SELECT id FROM c) GROUP BY 1)
    SELECT c.id, c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.format,
           c.competition_date, c.source_url, c.tournament_key, c.ename, c.start_date, c.end_date, c.city, c.country_code,
           coalesce(r.n, 0) res, coalesce(b.p, 0) p, coalesce(b.t, 0) t,
           (SELECT status FROM sport_import_coverage x WHERE x.source = 'fie' AND x.season = c.season
               AND x.competition_key = c.competition_key AND x.fact_kind = 'pools') cp,
           (SELECT status FROM sport_import_coverage x WHERE x.source = 'fie' AND x.season = c.season
               AND x.competition_key = c.competition_key AND x.fact_kind = 'tableau') ct
      FROM c LEFT JOIN r ON r.competition_id = c.id LEFT JOIN b ON b.competition_id = c.id
     ORDER BY CAST(c.season AS INTEGER), CAST(c.competition_key AS INTEGER)`).all(desde) as Record<string, string | number | null>[];
  return filas.map((f) => ({
    id: String(f.id),
    season: String(f.season),
    competitionKey: String(f.competition_key),
    weapon: f.weapon as PruebaBase['weapon'],
    gender: f.gender as PruebaBase['gender'],
    category: f.category as PruebaBase['category'],
    categoryRaw: (f.category_raw as string | null) ?? null,
    format: f.format as PruebaBase['format'],
    date: (f.competition_date as string | null) ?? null,
    tournamentKey: String(f.tournament_key),
    editionName: String(f.ename),
    startDate: (f.start_date as string | null) ?? null,
    endDate: (f.end_date as string | null) ?? null,
    city: (f.city as string | null) ?? null,
    countryCode: (f.country_code as string | null) ?? null,
    sourceUrl: (f.source_url as string | null) ?? null,
    resultados: Number(f.res),
    poule: Number(f.p),
    tableau: Number(f.t),
    coberturaPools: (f.cp as string | null) ?? null,
    coberturaTableau: (f.ct as string | null) ?? null,
  }));
}

export type AsaltoBase = { phase: 'POULE' | 'TABLEAU'; roundKey: string; aRef: string; bRef: string; scoreA: number; scoreB: number; aName: string; bName: string };

export function asaltosDeBase(db: DatabaseSync, competitionId: string): AsaltoBase[] {
  return (db.prepare(`SELECT phase, round_key, fencer_a_ref, fencer_b_ref, score_a, score_b, fencer_a_name, fencer_b_name
      FROM sport_bout WHERE competition_id = ?`).all(competitionId) as Record<string, string | number>[]).map((b) => ({
    phase: b.phase as AsaltoBase['phase'],
    roundKey: String(b.round_key),
    aRef: String(b.fencer_a_ref),
    bRef: String(b.fencer_b_ref),
    scoreA: Number(b.score_a),
    scoreB: Number(b.score_b),
    aName: String(b.fencer_a_name),
    bName: String(b.fencer_b_name),
  }));
}

export type PuestoBase = { factKey: string; name: string; countryCode: string | null; position: number | null };

export function puestosDeBase(db: DatabaseSync, competitionId: string): PuestoBase[] {
  return (db.prepare(`SELECT source_fact_key, source_name, source_country_code, position FROM sport_result
      WHERE competition_id = ? ORDER BY position IS NULL, position`).all(competitionId) as Record<string, string | number | null>[])
    .map((r) => ({
      factKey: String(r.source_fact_key),
      name: String(r.source_name),
      countryCode: (r.source_country_code as string | null) ?? null,
      position: r.position === null ? null : Number(r.position),
    }));
}

/** Grupo de prueba para los informes (por nombre de edición y categoría). */
export function grupoPrueba(nombre: string, categoria: string): string {
  const n = nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/south east asian|sea games/.test(n)) return 'SEA Games';
  if (/jeux olympiques|olympic games/.test(n) && !/jeunesse|youth/.test(n)) return 'Juegos Olímpicos';
  if (/championnats du monde|world championships/.test(n)) return categoria === 'VET' ? 'Mundiales veteranos' : 'Mundiales';
  if (/juniors-cadets|junior-cadet|cadets-juniors/.test(n)) return 'Mundiales júnior-cadete';
  if (/grand prix/.test(n)) return 'Grand Prix';
  if (/coupe du monde|world cup/.test(n)) return categoria === 'VET' ? 'Copas del Mundo veteranos' : 'Copas del Mundo';
  if (/satellite/.test(n)) return 'Satélites';
  if (/europe|european/.test(n)) return 'Campeonatos de Europa';
  if (/asiatiques|asian/.test(n)) return 'Campeonatos de Asia';
  if (/panamericains|pan american|panamerican/.test(n)) return 'Panamericanos';
  if (/afrique|african/.test(n)) return 'Campeonatos de África';
  if (/oceanie|oceania/.test(n)) return 'Oceanía';
  if (/mediterran/.test(n)) return 'Mediterráneos';
  if (/commonwealth/.test(n)) return 'Commonwealth';
  if (/universiade|fisu|university/.test(n)) return 'Universiadas/FISU';
  if (/joj|jeunesse|youth olympic/.test(n)) return 'Juegos Olímpicos de la Juventud';
  return 'Otros';
}
