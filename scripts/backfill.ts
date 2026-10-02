import 'dotenv/config';
import { ejecutarBackfillCli, parsearArgsBackfill, USO_BACKFILL, type DepsBackfillCli } from '../src/lib/ingest/backfill/cli';

/**
 * Backfill histórico acotado y reanudable (FIE, Skermo, PDF RFEE, Engarde, FWW):
 *
 *   npm run backfill                        -> SIMULACIÓN: lee la base (sólo SELECT), planifica y mide capacidad
 *   npm run backfill -- --aplicar           -> ejecuta un lote acotado y escribe en la base
 *
 * La simulación no hace ninguna petición a proveedores ni descubre el inventario por red; con
 * --aplicar el descubrimiento, las lecturas y los reintentos comparten un único
 * presupuesto de peticiones y de tiempo. No hay cron ni trigger
 * que lo lance: lo ejecuta una persona, de una instancia cada vez (un único
 * importador por clave de ranking es el límite operativo). Ver
 * docs/backfill-historico.md.
 */

const parseado = parsearArgsBackfill(process.argv.slice(2));
if (!parseado.ok) {
  console.error(`${parseado.error}\n\n${USO_BACKFILL}`);
  process.exit(1);
}
const opciones = parseado.opciones;

const { db } = await import('../src/db');
const { consultaSqlDb, medirOcupacion } = await import('../src/lib/ingest/backfill/capacidad-db');
const { contarReferenciasHistoricas, leerCoberturaAgregada, leerFilasPlan, leerIndicesPersistidos } = await import(
  '../src/lib/ingest/backfill/cobertura-db'
);
const { categoriasHistoricasAplicadas, esquemaDeportivo } = await import('../src/lib/sport/esquema-db');

const consultar = consultaSqlDb(db);
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
    fetchJson: (url: string) => fetchJson<unknown>(url, { timeoutMs: 60_000, retries: 0 }),
    skermoIndice: inventarioSkermo.indice,
    skermoTemporadas: inventarioSkermo.temporadas,
    skermoParsear: inventarioSkermo.parsear,
    skermoHtml: crearDepsLecturaSkermoRed({ retries: 0 }).html,
    engarde: depsEngardeReales,
    bytesPdf: (url: string) => descargarPdf(url),
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
  esquema: esquemaDeportivo,
  categoriasAmpliadas: () => categoriasHistoricasAplicadas(),
  medir: () => medirOcupacion(consultar),
  descubrir,
  crearEjecutor,
  ahora: () => new Date(),
  dormir,
};

const resultado = await ejecutarBackfillCli(deps, opciones);
for (const linea of resultado.lineas) console.log(linea);
if (!opciones.aplicar) console.log('Modo simulación: no se ha escrito nada. Añade --aplicar para ejecutar el lote.');
process.exitCode = resultado.codigo;