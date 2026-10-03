import 'dotenv/config';
import { ejecutarBackfillCli, parsearArgsBackfill, USO_BACKFILL, type DepsBackfillCli } from '../src/lib/ingest/backfill/cli';
import { abrirD1Local, destinoD1Local } from '../src/lib/ingest/sport-incremental/local';
import { comprobarCooldownD1, guardarCooldownD1 } from '../src/lib/ingest/sport-incremental/cooldown';
import { clasificarFalloTecnico } from '../src/lib/ingest/backfill/orquestador';

/**
 * Backfill histórico acotado y reanudable (FIE, Skermo, PDF RFEE, Engarde, FWW):
 *
 *   npm run backfill -- --d1-local C:\datos\app.sqlite             -> simulación, sólo lecturas locales
 *   npm run backfill -- --d1-local C:\datos\app.sqlite --aplicar   -> lote local acotado
 *
 * La simulación no hace ninguna petición a proveedores ni descubre el inventario por red; con
 * --aplicar el descubrimiento, las lecturas y los reintentos comparten un único
 * presupuesto de peticiones y de tiempo. No hay cron ni trigger
 * que lo lance: lo ejecuta una persona. SQL0002 se exige DESPUÉS del import
 * verificado; toda escritura reclama el lease global. Simulación sin escribir. Ver
 * docs/backfill-historico.md.
 */

let target: ReturnType<typeof destinoD1Local>;
try {
  target = destinoD1Local(process.argv.slice(2), process.argv.includes('--aplicar'));
} catch {
  console.error('Se exige --d1-local <ruta absoluta de SQLite existente>. Sin destino remoto ni DATABASE_URL para --aplicar.');
  process.exit(2);
}
const parseado = parsearArgsBackfill(target.args);
if (!parseado.ok) {
  console.error(`${parseado.error}\n\n${USO_BACKFILL}`);
  process.exit(1);
}
const opciones = parseado.opciones;
const local = abrirD1Local(target.path, opciones.aplicar);
const rawDb = local.db;
let db = rawDb;
const { consultaSqlDb, medirOcupacion, planCapacidadD1 } = await import('../src/lib/ingest/backfill/capacidad-db');
opciones.planNeon = planCapacidadD1();
const { contarReferenciasHistoricas, leerCoberturaAgregada, leerFilasPlan, leerIndicesPersistidos } = await import(
  '../src/lib/ingest/backfill/cobertura-db'
);
const { categoriasD1, esquemaD1 } = await import('../src/lib/ingest/backfill/identidad-db');

const consultar = consultaSqlDb(rawDb);
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const estadoRed: { fallo: { status: number | null; retryAfterMs: number | null } | null } = { fallo: null };
async function vigilar<T>(fn: () => Promise<T>): Promise<T> {
  if (estadoRed.fallo) throw new Error('sport_source_cooldown');
  await dormir(400);
  try { return await fn(); }
  catch (e) {
    estadoRed.fallo ??= clasificarFalloTecnico(e) ?? { status: null, retryAfterMs: null };
    throw e;
  }
}
async function vigilarHttp<T extends { status: number; retryAfterMs?: number | null }>(fn: () => Promise<T>): Promise<T> {
  const r = await vigilar(fn);
  if (r.status === 429 || r.status >= 500) {
    estadoRed.fallo = { status: r.status, retryAfterMs: r.retryAfterMs ?? null };
    throw new Error('sport_source_cooldown');
  }
  return r;
}

/**
 * Red base: una petición por llamada y sin reintentos internos (`retries: 0`).
 * El presupuesto del lote se aplica por encima, en `crearRedPresupuestada`, y el
 * reintento con su espera lo decide el orquestador.
 */
async function redBase() {
  const { fetchJson } = await import('../src/lib/ingest/fetcher');
  const { crearDepsInventarioSkermoRed, crearDepsLecturaSkermoRed } = await import('../src/lib/ingest/historico-red');
  const { depsEngardeReales } = await import('../src/lib/ingest/sources/engarde');
  const { descargarPdf } = await import('../src/lib/ingest/sources/rfee-pdf/lectura');
  const inventarioSkermo = crearDepsInventarioSkermoRed({ retries: 0 });
  return {
    fetchJson: (url: string) => vigilar(() => fetchJson<unknown>(url, { timeoutMs: 60_000, retries: 0 })),
    skermoIndice: (...args: Parameters<typeof inventarioSkermo.indice>) => vigilar(() => inventarioSkermo.indice(...args)),
    skermoTemporadas: inventarioSkermo.temporadas,
    skermoParsear: inventarioSkermo.parsear,
    skermoHtml: (url: string) => vigilar(() => crearDepsLecturaSkermoRed({ retries: 0 }).html(url)),
    engarde: {
      get: (...args: Parameters<typeof depsEngardeReales.get>) => vigilarHttp(() => depsEngardeReales.get(...args)),
      post: (...args: Parameters<typeof depsEngardeReales.post>) => vigilarHttp(() => depsEngardeReales.post(...args)),
      esperar: dormir,
    },
    bytesPdf: (url: string) => vigilar(() => descargarPdf(url)),
  };
}

async function descubrir(e: Parameters<NonNullable<DepsBackfillCli['descubrir']>>[0]) {
  const { crearRedPresupuestada } = await import('../src/lib/ingest/backfill/red-presupuestada');
  const { descubrirCatalogo } = await import('../src/lib/ingest/backfill/descubrimiento');
  const { federacionesSkermo } = await import('../src/lib/ingest/historico-red');
  const { crearDepsPersistenciaDescubrimientoDb } = await import('../src/lib/ingest/inventario-historico-db');
  const red = crearRedPresupuestada(e.presupuesto, dormir, await redBase());
  return descubrirCatalogo(
    {
      fie: red.inventarioFie,
      skermo: red.inventarioSkermo,
      federaciones: () => federacionesSkermo(),
      persistencia: crearDepsPersistenciaDescubrimientoDb(db),
    },
    { fuentes: e.fuentes, temporadas: e.temporadas },
    e.maxPeticiones,
  );
}

async function crearEjecutor(presupuesto: Parameters<DepsBackfillCli['crearEjecutor']>[0], guarda: Parameters<DepsBackfillCli['crearEjecutor']>[1]) {
  const { crearEjecutor } = await import('../src/lib/ingest/backfill/ejecutores');
  const { crearRedPresupuestada } = await import('../src/lib/ingest/backfill/red-presupuestada');
  const { crearDepsPersistenciaFieDb } = await import('../src/lib/ingest/fie-resultados-db');
  const { crearDepsPersistenciaSkermoDb } = await import('../src/lib/ingest/skermo-finales-db');
  const { crearDepsPersistenciaPdfDb } = await import('../src/lib/ingest/backfill/pdf-db');
  const { crearDepsComplementoDb, cargarCanonicasDb, cargarCanonicaPorIdDb } = await import(
    '../src/lib/ingest/complementarios-db'
  );
  const { leerFinalSkermo } = await import('../src/lib/ingest/sources/skermo-finales');
  const { leerPdfRfee } = await import('../src/lib/ingest/sources/rfee-pdf/lectura');
  const { descubrirEnlacesFie } = await import('../src/lib/ingest/enlaces-resultados');

  const red = crearRedPresupuestada(presupuesto, dormir, await redBase());

  const indicesSkermo = new Map<string, Awaited<ReturnType<typeof red.inventarioSkermo.parsear>>>();
  async function indiceSkermo(federacion: string, temporada: string) {
    const clave = `${federacion}|${temporada}`;
    const guardado = indicesSkermo.get(clave);
    if (guardado) return guardado;
    const base = await red.inventarioSkermo.indice(federacion);
    const opcion = red.inventarioSkermo.temporadas(base).find((o) => o.label === temporada);
    if (!opcion) throw new Error(`Skermo/${federacion} no publica la temporada ${temporada}`);
    const html = opcion.selected ? base : await red.inventarioSkermo.indice(federacion, opcion.value);
    const indice = red.inventarioSkermo.parsear(html, federacion);
    indicesSkermo.set(clave, indice);
    return indice;
  }

  const persistenciaComplemento = crearDepsComplementoDb(db);
  return crearEjecutor({
    capacidad: guarda,
    fie: {
      lectura: red.fie,
      persistencia: crearDepsPersistenciaFieDb(db),
      cursorActual: async (season, competitionId) => {
        const filas = await consultar(
          `select cursor from sport_import_coverage
           where source = 'fie' and fact_kind = 'ranking' and season = '${Number(season)}'
             and competition_key = '${Number(competitionId)}' limit 1`,
        );
        const cursor = filas[0]?.cursor;
        return typeof cursor === 'string' ? cursor : null;
      },
      fasesActuales: async (season, competitionId) => {
        const filas = await consultar(
          `select fact_kind, status, cursor from sport_import_coverage
           where source = 'fie' and fact_kind in ('ranking','pools','tableau') and season = '${Number(season)}'
             and competition_key = '${Number(competitionId)}'`,
        );
        const de = (tipo: string) => {
          const f = filas.find((x) => x.fact_kind === tipo);
          return f ? { status: String(f.status), cursor: typeof f.cursor === 'string' ? f.cursor : null } : null;
        };
        return { ranking: de('ranking'), pools: de('pools'), tableau: de('tableau') };
      },
    },
    skermo: {
      leer: async ({ federacion, season, competitionId }) => {
        const indice = await indiceSkermo(federacion, season);
        const fila = indice.rows.find((r) => r.competitionId === competitionId);
        if (!fila) throw new Error(`La fila ${competitionId} ya no está en el índice de Skermo/${federacion} ${season}`);
        return leerFinalSkermo(fila, { federacion, season }, red.lecturaSkermo);
      },
      persistencia: crearDepsPersistenciaSkermoDb(db),
    },
    pdf: { leer: (url) => leerPdfRfee(url, red.pdf), persistencia: crearDepsPersistenciaPdfDb(db) },
    complementarios: {
      engarde: red.engarde,
      persistencia: persistenciaComplemento,
      cargarCanonicas: (rango) => cargarCanonicasDb(db, rango),
      cargarCanonicaPorId: (id) => cargarCanonicaPorIdDb(db, id),
    },
    enlaces: {
      descubrir: (season, competitionId) => descubrirEnlacesFie(red.engarde, season, competitionId),
      persistencia: persistenciaComplemento,
    },
  });
}

const deps: DepsBackfillCli = {
  leerFilas: (filtro) => leerFilasPlan(consultar, filtro),
  leerAgregada: () => leerCoberturaAgregada(consultar),
  leerReferencias: () => contarReferenciasHistoricas(consultar),
  leerIndices: () => leerIndicesPersistidos(consultar),
  esquema: esquemaD1(rawDb),
  categoriasAmpliadas: categoriasD1(rawDb),
  medir: () => medirOcupacion(consultar),
  descubrir,
  crearEjecutor,
  ahora: () => new Date(),
  dormir,
};

let lease: import('../src/lib/ingest/sport-incremental/lease').SportLease | null = null;
try {
  if (opciones.aplicar) {
    const { reclamarSportLease, dbConSportLease } = await import('../src/lib/ingest/sport-incremental/lease');
    const { crearGuardaCapacidad } = await import('../src/lib/ingest/backfill/guarda-capacidad');
    lease = await reclamarSportLease(rawDb);
    if (!lease) throw new Error('sport_busy');
    await comprobarCooldownD1(rawDb);
    // Discovery writes seeds too: capacity must pass BEFORE discovery, not just facts.
    const guard = crearGuardaCapacidad({ plan: planCapacidadD1(), medir: () => medirOcupacion(consultar) });
    if (!(await guard({ puestos: 0, asaltos: 0, documentos: 0, unidades: opciones.maxPeticiones * 100 })).continuar) {
      throw new Error('sport_capacity');
    }
    db = dbConSportLease(rawDb, lease, () => { if (estadoRed.fallo) throw new Error('sport_source_cooldown'); });
  }
  const resultado = await ejecutarBackfillCli(deps, opciones);
  for (const linea of resultado.lineas) {
    // Legacy pure CLI messages may append a caught driver/source exception.
    // Keep aggregate states, never SQL params, athlete data or raw errors.
    if (/índice con error:|Descubrimiento fallido:/i.test(linea)) console.log('Lectura detenida: detalle técnico omitido.');
    else console.log(linea.startsWith('  ') ? linea.split(' · ')[0] : linea);
  }
  if (!opciones.aplicar) console.log('Modo simulación: no se ha escrito nada. Añade --aplicar para ejecutar el lote.');
  process.exitCode = estadoRed.fallo ? 4 : resultado.codigo;
} catch {
  console.error('Backfill D1 detenido: revisar SQL0002 posterior al import, lease global y presupuesto de almacenamiento.');
  process.exitCode = 2;
} finally {
  if (lease) {
    if (estadoRed.fallo) {
      try {
        const { dbConSportLease } = await import('../src/lib/ingest/sport-incremental/lease');
        await guardarCooldownD1(dbConSportLease(rawDb, lease),
          new Date(Date.now() + Math.max(60_000, estadoRed.fallo.retryAfterMs ?? 3_600_000)));
      } catch { console.error('No se pudo guardar el cooldown; requiere revisión antes de reintentar.'); process.exitCode = 2; }
    }
    try { await lease.liberar(); }
    catch { console.error('No se pudo liberar el lease deportivo; se conserva hasta su caducidad.'); process.exitCode = 2; }
  }
  local.close();
}