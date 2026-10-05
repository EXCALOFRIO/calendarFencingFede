import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { urlCuadro, urlPoules, urlPrueba, urlRanking } from '../../src/lib/ingest/sources/fie-resultados';
import { RAIZ_DATOS } from './comun';

/**
 * Descarga reanudable de las pruebas FIE indexadas pero sin caché local.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-descargar-antiguas.ts [--base <sqlite>] [--salida <dir>] [--limite N]
 *     [--ids <temporada:id,...>] [--lista <fichero>]
 *
 * Guarda cada respuesta tal cual en `<salida>/raw/<season>-<id>-<kind>.json` y una línea por
 * prueba terminada en `<salida>/progress.jsonl`. Una prueba con línea en progress se salta; un
 * fichero raw ya presente no se vuelve a pedir. Una petición a la vez, >=400 ms entre inicios.
 * 429/5xx: espera Retry-After (o backoff) y reintenta; 403 o robots que prohíba: se para.
 *
 * Con `--ids` o `--lista` (un `temporada:id` por línea o separados por comas; `#` comenta) se
 * descargan sólo esas pruebas y no se consulta la base: sirve para releer unas pocas pruebas
 * ya indexadas. `fie-antiguas-a-hechos.ts --entrada <salida>` las convierte después.
 */

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const TMP = RAIZ_DATOS;
const BASE = opt('--base', path.join(TMP, 'calendario-trabajo', 'base.sqlite'));
const SALIDA = opt('--salida', path.join(TMP, 'calendario-trabajo', 'fie-antiguo'));
const LIMITE = Number(opt('--limite', '0')) || Infinity;
const IDS = opt('--ids', '');
const LISTA = opt('--lista', '');
const RAW = path.join(SALIDA, 'raw');
const PROGRESO = path.join(SALIDA, 'progress.jsonl');
const PARADA = path.join(SALIDA, 'STOP');
const MAX_BYTES = 1.5 * 1024 ** 3;
const INTERVALO_MS = 400;
const TAMANO_PAGINA = 200;
const UA = process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+https://calendario-fie-fede.excalofrio.workers.dev)';

class Bloqueo extends Error {}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ultimoInicio = 0;
let peticiones = 0;
let bytesRaw = 0;

/** `temporada:id` separados por comas, espacios o líneas, sin repetidos y ordenados. */
export function pruebasDeLista(texto: string): { season: number; id: number }[] {
  const vistas = new Map<string, { season: number; id: number }>();
  for (const linea of texto.split(/\r?\n/)) {
    for (const t of linea.replace(/#.*/, '').split(/[\s,;]+/)) {
      if (!t) continue;
      const m = /^(\d{4}):(\d+)$/.exec(t);
      if (!m) throw new Error(`prueba mal escrita: «${t}» (se espera temporada:id)`);
      const p = { season: Number(m[1]), id: Number(m[2]) };
      vistas.set(`${p.season}-${p.id}`, p);
    }
  }
  return [...vistas.values()].sort((a, b) => a.season - b.season || a.id - b.id);
}

function retryAfterMs(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}

type Respuesta = { status: number; cuerpo: string };

async function pedir(url: string): Promise<Respuesta> {
  let espera = 30_000;
  for (let intento = 1; ; intento += 1) {
    const hueco = ultimoInicio + INTERVALO_MS - Date.now();
    if (hueco > 0) await dormir(hueco);
    ultimoInicio = Date.now();
    peticiones += 1;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        redirect: 'error',
        signal: AbortSignal.timeout(40_000),
      });
    } catch (e) {
      if (intento >= 6) throw new Error(`red: ${(e as Error).message}`.slice(0, 200));
      log(`red fallida (${intento}), espera ${espera / 1000}s`);
      await dormir(espera);
      espera = Math.min(espera * 2, 600_000);
      continue;
    }
    if (res.status === 403) throw new Bloqueo(`HTTP 403 en ${url}`);
    if (res.status === 429 || res.status >= 500) {
      const ra = retryAfterMs(res.headers.get('retry-after'));
      await res.body?.cancel();
      if (intento >= 8) throw new Bloqueo(`HTTP ${res.status} persistente en ${url}`);
      const ms = Math.max(ra ?? espera, 5_000);
      log(`HTTP ${res.status} (${intento}), espera ${Math.round(ms / 1000)}s`);
      await dormir(ms);
      espera = Math.min(espera * 2, 900_000);
      continue;
    }
    return { status: res.status, cuerpo: await res.text() };
  }
}

function escribir(fichero: string, contenido: string) {
  const tmp = `${fichero}.tmp`;
  writeFileSync(tmp, contenido);
  renameSync(tmp, fichero);
  bytesRaw += Buffer.byteLength(contenido);
  if (bytesRaw > MAX_BYTES) throw new Bloqueo(`raw supera ${MAX_BYTES} bytes`);
}

/** Respuesta de un documento: del disco si ya está; si no, de la red y se guarda. */
async function documento(season: number, id: number, kind: string, url: string): Promise<{ status: number; json: unknown; deRed: boolean }> {
  const fichero = path.join(RAW, `${season}-${id}-${kind}.json`);
  if (existsSync(fichero)) return { status: 200, json: JSON.parse(readFileSync(fichero, 'utf8')), deRed: false };
  const r = await pedir(url);
  if (r.status !== 200) return { status: r.status, json: null, deRed: true };
  let json: unknown;
  try {
    json = JSON.parse(r.cuerpo);
  } catch {
    return { status: -1, json: null, deRed: true };
  }
  escribir(fichero, r.cuerpo);
  return { status: 200, json, deRed: true };
}

function log(m: string) {
  console.log(`${new Date().toISOString()} ${m}`);
}

type Linea = {
  season: number;
  id: number;
  estado: 'con_resultados' | 'sin_resultados' | 'error';
  tipo: string | null;
  ranking: number | null;
  paginas: number;
  pools: number | null;
  tableau: number | null;
  error: string | null;
  ts: string;
};

async function descargarPrueba(season: number, id: number): Promise<Linea> {
  const linea: Linea = { season, id, estado: 'error', tipo: null, ranking: null, paginas: 0, pools: null, tableau: null, error: null, ts: '' };
  const meta = await documento(season, id, 'meta', urlPrueba(season, id));
  if (meta.status !== 200) {
    linea.error = `meta HTTP ${meta.status}`;
    return linea;
  }
  const m = meta.json as { type?: string | null; competitionId?: number; season?: number } | null;
  if (!m || typeof m !== 'object' || m.competitionId !== id || m.season !== season) {
    linea.error = 'meta no corresponde a la prueba';
    return linea;
  }
  linea.tipo = m.type ?? null;

  let total: number | null = null;
  for (let pagina = 1; pagina <= 200; pagina += 1) {
    const r = await documento(season, id, `ranking-p${pagina}`, urlRanking(season, id, pagina, TAMANO_PAGINA));
    if (r.status !== 200) {
      linea.error = `ranking p${pagina} HTTP ${r.status}`;
      return linea;
    }
    const p = r.json as { totalFound?: number; items?: unknown[] };
    if (typeof p?.totalFound !== 'number' || !Array.isArray(p.items)) {
      linea.error = `ranking p${pagina} forma inesperada`;
      return linea;
    }
    total = p.totalFound;
    linea.paginas = pagina;
    if (p.items.length === 0 || pagina * TAMANO_PAGINA >= p.totalFound) break;
  }
  linea.ranking = total;

  if (m.type === 'I') {
    const po = await documento(season, id, 'pools', urlPoules(season, id));
    if (po.status === 200) linea.pools = Array.isArray((po.json as { pools?: unknown[] })?.pools) ? (po.json as { pools: unknown[] }).pools.length : null;
    else linea.error = `pools HTTP ${po.status}`;
    const ta = await documento(season, id, 'tableau', urlCuadro(season, id));
    if (ta.status === 200) linea.tableau = Array.isArray((ta.json as { tableau?: unknown[] })?.tableau) ? (ta.json as { tableau: unknown[] }).tableau.length : null;
    else linea.error = [linea.error, `tableau HTTP ${ta.status}`].filter(Boolean).join('; ');
  }
  if (linea.error) return linea;
  linea.estado = (total ?? 0) > 0 || (linea.pools ?? 0) > 0 || (linea.tableau ?? 0) > 0 ? 'con_resultados' : 'sin_resultados';
  return linea;
}

function pendientes(): { season: number; id: number }[] {
  const db = new DatabaseSync(BASE, { readOnly: true });
  const filas = db
    .prepare(
      `SELECT DISTINCT season, competition_key FROM sport_import_coverage
       WHERE source='fie' AND (
         (fact_kind='ranking' AND status IN ('pendiente','error'))
         OR (fact_kind='competitions' AND status='error'))`,
    )
    .all() as { season: string; competition_key: string }[];
  db.close();
  return filas
    .map((f) => ({ season: Number(f.season), id: Number(f.competition_key) }))
    .filter((f) => Number.isInteger(f.season) && Number.isInteger(f.id))
    .sort((a, b) => a.season - b.season || a.id - b.id);
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  for (const f of readdirSync(RAW)) bytesRaw += statSync(path.join(RAW, f)).size;
  const dirigidas = IDS || LISTA ? pruebasDeLista([IDS, LISTA ? readFileSync(LISTA, 'utf8') : ''].join('\n')) : null;
  if (dirigidas && dirigidas.length === 0) throw new Error('--ids/--lista sin pruebas');

  const robots = await pedir('https://fie.org/robots.txt');
  if (robots.status === 200 && /^\s*Disallow:\s*\/(api)?\s*$/im.test(robots.cuerpo)) {
    throw new Bloqueo('robots.txt prohíbe el acceso');
  }

  const hechas = new Set<string>();
  if (existsSync(PROGRESO)) {
    for (const l of readFileSync(PROGRESO, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const j = JSON.parse(l) as Linea;
        // Las que fallaron se reintentan en la siguiente ejecución.
        if (j.estado !== 'error') hechas.add(`${j.season}-${j.id}`);
      } catch {
        /* línea truncada por una parada brusca */
      }
    }
  }
  const lista = (dirigidas ?? pendientes()).filter((p) => !hechas.has(`${p.season}-${p.id}`));
  log(`pendientes ${lista.length} (ya hechas ${hechas.size}); raw ${(bytesRaw / 1e6).toFixed(1)} MB`);

  const cuenta = { con_resultados: 0, sin_resultados: 0, error: 0 };
  let n = 0;
  for (const p of lista) {
    if (n >= LIMITE) break;
    if (existsSync(PARADA)) {
      log('fichero STOP presente: se para');
      break;
    }
    n += 1;
    let linea: Linea;
    try {
      linea = await descargarPrueba(p.season, p.id);
    } catch (e) {
      if (e instanceof Bloqueo) throw e;
      linea = { season: p.season, id: p.id, estado: 'error', tipo: null, ranking: null, paginas: 0, pools: null, tableau: null, error: (e as Error).message.slice(0, 200), ts: '' };
    }
    linea.ts = new Date().toISOString();
    appendFileSync(PROGRESO, `${JSON.stringify(linea)}\n`);
    cuenta[linea.estado] += 1;
    if (n % 25 === 0 || n === lista.length) {
      log(`hechas ${n}/${lista.length} última ${p.season}/${p.id} con=${cuenta.con_resultados} sin=${cuenta.sin_resultados} err=${cuenta.error} peticiones=${peticiones} raw=${(bytesRaw / 1e6).toFixed(1)}MB`);
    }
  }
  log(`FIN hechas ${n} con=${cuenta.con_resultados} sin=${cuenta.sin_resultados} err=${cuenta.error} peticiones=${peticiones}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    log(`${e instanceof Bloqueo ? 'BLOQUEADO' : 'ERROR'}: ${(e as Error).message}`);
    process.exit(2);
  });
}
