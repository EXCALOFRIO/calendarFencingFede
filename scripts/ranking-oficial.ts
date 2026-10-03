import 'dotenv/config';
import { abrirD1Local, destinoD1Local } from '../src/lib/ingest/sport-incremental/local';
import { comprobarCooldownD1, guardarCooldownD1 } from '../src/lib/ingest/sport-incremental/cooldown';
import { clasificarFalloTecnico } from '../src/lib/ingest/backfill/orquestador';
import { fetchJson, fetchText } from '../src/lib/ingest/fetcher';
import {
  combinacionesRfee,
  claveRanking,
  leerRankingFie,
  leerRankingRfee,
  tareasRankingFie,
  type LecturaRanking,
} from '../src/lib/ingest/sources/ranking-oficial-historico';
import {
  parseSkermoRankingCategories,
  parseSkermoSeasons,
  RANKING_FEDERATION,
  skermoRankingFormUrl,
} from '../src/lib/ingest/sources/ranking-rfee';

/**
 * Rankings OFICIALES (no el cálculo interno) de una temporada:
 *
 *   npm run ranking-oficial -- rfee 2021-2022 --max 6            -> lectura y resumen, no escribe
 *   npm run ranking-oficial -- fie 2024 --max 6 --aplicar --d1-local C:\datos\app.sqlite
 *
 * RFEE: la temporada se lee del formulario de Skermo y sólo se piden las
 * categorías que el formulario ofrece (hoy no incluye M10/M12). FIE: 48 listas
 * por año (individual y equipos). Sin `--aplicar` sólo hace GET públicos y
 * muestra recuentos, sin nombres. `--aplicar` omite las listas ya cerradas
 * (salvo `--releer`) y exige SQL0002 aplicado DESPUÉS del import verificado.
 * No admite Neon ni escritura remota. `--max` aplaza listas, no las recorta.
 */

let args = process.argv.slice(2);
let target: ReturnType<typeof destinoD1Local> | null = null;
if (args.includes('--aplicar')) {
  try { target = destinoD1Local(args, true); args = target.args; }
  catch { console.error('Se exige --d1-local <ruta absoluta de SQLite existente>, sin DATABASE_URL ni destino remoto.'); process.exit(2); }
}
const maxArg = args.indexOf('--max');
const [fuenteArg, temporada] = args.filter((a, i) => !a.startsWith('--') && i !== maxArg + 1);
const max = maxArg >= 0 ? Number(args[maxArg + 1]) : 6;
const aplicar = args.includes('--aplicar');
const releer = args.includes('--releer');
const PAUSA_MS = 400;

if (
  !(fuenteArg === 'rfee' || fuenteArg === 'fie') ||
  !temporada ||
  !Number.isInteger(max) ||
  max < 1 ||
  max > 48 ||
  (fuenteArg === 'fie' && !/^\d{4}$/.test(temporada)) ||
  (fuenteArg === 'rfee' && !/^\d{4}-\d{4}$/.test(temporada))
) {
  console.error('Uso: npm run ranking-oficial -- <rfee AAAA-AAAA | fie AAAA> [--max N] [--aplicar] [--releer]');
  process.exit(1);
}

const hoy = new Date().toISOString().slice(0, 10);
const fuente = fuenteArg === 'rfee' ? 'skermo_ranking' : 'fie_tiradores';

type Tarea = { clave: string; leer: () => Promise<LecturaRanking> };
const tareas: Tarea[] = [];

async function construirTareas() {
if (fuenteArg === 'rfee') {
  const formulario = await red(() => fetchText(skermoRankingFormUrl(RANKING_FEDERATION), { timeoutMs: 6_000, retries: 0 }).then((r) => r.body));
  const opcion = parseSkermoSeasons(formulario).find((o) => o.label === temporada);
  if (!opcion) {
    console.error(`El ranking de Skermo/${RANKING_FEDERATION} no publica la temporada ${temporada}.`);
    throw new Error('sport_ranking_season_unavailable');
  }
  const deps = { html: (url: string) => red(() => fetchText(url, { timeoutMs: 6_000, retries: 0 }).then((r) => r.body)) };
  for (const combo of combinacionesRfee(parseSkermoRankingCategories(formulario))) {
    tareas.push({
      clave: claveRanking(combo.weapon, combo.gender, combo.categoryRaw, 'INDIVIDUAL'),
      leer: () => leerRankingRfee({ season: opcion, combo, hoy }, deps),
    });
  }
} else {
  const deps = { json: (url: string) => red(() => fetchJson<unknown>(url, { timeoutMs: 6_000, retries: 0 })) };
  const armas = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' } as const;
  for (const t of tareasRankingFie(Number(temporada))) {
    tareas.push({
      clave: claveRanking(armas[t.weapon as keyof typeof armas], t.gender, t.category, t.tipo === 'E' ? 'EQUIPOS' : 'INDIVIDUAL'),
      leer: () => leerRankingFie(t, hoy, deps),
    });
  }
}
console.log(`${fuenteArg.toUpperCase()} ${temporada}: ${tareas.length} listas posibles.`);
}

let persistencia: {
  deps: import('../src/lib/ingest/ranking-oficial-persist').DepsPersistenciaRanking;
  persistir: typeof import('../src/lib/ingest/ranking-oficial-persist').persistirLecturaRanking;
  cerradas: Set<string>;
} | null = null;
let lease: import('../src/lib/ingest/sport-incremental/lease').SportLease | null = null;
let guard: import('../src/lib/ingest/backfill/guarda-capacidad').GuardaCapacidad | null = null;
let local: ReturnType<typeof abrirD1Local> | null = null;
const estadoRed: { fallo: { status: number | null; retryAfterMs: number | null } | null } = { fallo: null };
let requests = 0;
async function red<T>(fn: () => Promise<T>): Promise<T> {
  if (estadoRed.fallo || requests >= max + 1) throw new Error('sport_source_stopped');
  requests++;
  await new Promise((r) => setTimeout(r, PAUSA_MS));
  try { return await fn(); }
  catch (e) { estadoRed.fallo = clasificarFalloTecnico(e) ?? { status: null, retryAfterMs: null }; throw e; }
}

try {
if (aplicar) {
  if (!target) throw new Error('sport_cli_requires_explicit_d1_local');
  local = abrirD1Local(target.path, true);
  const rawDb = local.db;
  const { crearDepsPersistenciaRankingDb, clavesRankingLeidas } = await import('../src/lib/ingest/ranking-oficial-db');
  const { persistirLecturaRanking } = await import('../src/lib/ingest/ranking-oficial-persist');
  const { reclamarSportLease, dbConSportLease } = await import('../src/lib/ingest/sport-incremental/lease');
  const { crearGuardaCapacidad } = await import('../src/lib/ingest/backfill/guarda-capacidad');
  const { consultaSqlDb, medirOcupacion, planCapacidadD1 } = await import('../src/lib/ingest/backfill/capacidad-db');
  lease = await reclamarSportLease(rawDb);
  if (!lease) throw new Error('sport_busy');
  await comprobarCooldownD1(rawDb);
  const db = dbConSportLease(rawDb, lease, () => { if (estadoRed.fallo) throw new Error('sport_source_stopped'); });
  guard = crearGuardaCapacidad({ plan: planCapacidadD1(), medir: () => medirOcupacion(consultaSqlDb(rawDb)) });
  if (!(await guard({ puestos: 0, asaltos: 0, documentos: 0, unidades: 1 })).continuar) throw new Error('sport_capacity');
  persistencia = {
    deps: crearDepsPersistenciaRankingDb(db),
    persistir: persistirLecturaRanking,
    cerradas: await clavesRankingLeidas(db, fuente, temporada),
  };
}
await construirTareas();

const pendientes = tareas.filter((t) => releer || !persistencia?.cerradas.has(t.clave));
const lote = pendientes.slice(0, max);
const estados: Record<string, number> = {};
const escritura: Record<string, number> = {};
let filas = 0;
for (const tarea of lote) {
  const lectura = await tarea.leer();
  if (estadoRed.fallo) throw new Error('sport_source_stopped');
  estados[lectura.cobertura.estado] = (estados[lectura.cobertura.estado] ?? 0) + 1;
  filas += lectura.publicacion?.entradas.length ?? 0;
  if (persistencia) {
    if (!guard || !(await guard({ puestos: lectura.publicacion?.entradas.length ?? 0,
      asaltos: 0, documentos: 0, unidades: 1 })).continuar) throw new Error('sport_capacity');
    const r = await persistencia.persistir(persistencia.deps, lectura);
    const clave = r.publicacion ?? r.estado;
    escritura[clave] = (escritura[clave] ?? 0) + 1;
  }
  await new Promise((r) => setTimeout(r, PAUSA_MS));
}
console.log(
  `Leídas ${lote.length} de ${pendientes.length} pendientes: estados=${JSON.stringify(estados)} filas=${filas}` +
    (persistencia ? ` escritura=${JSON.stringify(escritura)}` : '') +
    (pendientes.length > lote.length ? ` (quedan ${pendientes.length - lote.length} para otra ejecución)` : ''),
);
if (!aplicar) console.log('Modo lectura: no se ha escrito nada. Añade --aplicar para guardar.');
} catch {
  console.error('Ranking D1 detenido: revisar SQL0002 posterior al import, lease global, cooldown y capacidad. Sin errores del driver.');
  process.exitCode = 2;
} finally {
  if (lease) {
    if (estadoRed.fallo && local) {
      try {
        const { dbConSportLease } = await import('../src/lib/ingest/sport-incremental/lease');
        await guardarCooldownD1(dbConSportLease(local.db, lease),
          new Date(Date.now() + Math.max(60_000, estadoRed.fallo.retryAfterMs ?? 3_600_000)));
      } catch { console.error('No se pudo guardar el cooldown; requiere revisión antes de reintentar.'); }
    }
    try { await lease.liberar(); }
    catch { console.error('No se pudo liberar el lease deportivo; se conserva hasta su caducidad.'); process.exitCode = 2; }
  }
  local?.close();
}
