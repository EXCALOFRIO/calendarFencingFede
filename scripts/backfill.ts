import 'dotenv/config';
import { ejecutarBackfillCli, parsearArgsBackfill, USO_BACKFILL, type DepsBackfillCli } from '../src/lib/ingest/backfill/cli';

/**
 * Backfill histórico acotado y reanudable (FIE, Skermo, PDF RFEE, Engarde, FWW):
 *
 *   npm run backfill                        -> SIMULACIÓN: lee la base (sólo SELECT), planifica y mide capacidad
 *   npm run backfill -- --aplicar           -> ejecuta un lote acotado y escribe en la base
 *
 * La simulación no hace ninguna petición a proveedores. No hay cron ni trigger
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
const { contarReferenciasHistoricas, leerCoberturaAgregada, leerFilasPlan } = await import(
  '../src/lib/ingest/backfill/cobertura-db'
);
const { categoriasHistoricasAplicadas, esquemaDeportivo } = await import('../src/lib/sport/esquema-db');

const consultar = consultaSqlDb(db);

async function crearEjecutor() {
  const { fetchJson } = await import('../src/lib/ingest/fetcher');
  const { crearEjecutor } = await import('../src/lib/ingest/backfill/ejecutores');
  const { crearDepsPersistenciaFieDb } = await import('../src/lib/ingest/fie-resultados-db');
  const { crearDepsPersistenciaSkermoDb } = await import('../src/lib/ingest/skermo-finales-db');
  const { crearDepsPersistenciaPdfDb } = await import('../src/lib/ingest/backfill/pdf-db');
  const { crearDepsComplementoDb, cargarCanonicasDb, cargarCanonicaPorIdDb } = await import(
    '../src/lib/ingest/complementarios-db'
  );
  const { depsInventarioSkermoRed, depsLecturaSkermoRed } = await import('../src/lib/ingest/historico-red');
  const { leerFinalSkermo } = await import('../src/lib/ingest/sources/skermo-finales');
  const { leerPdfRfee } = await import('../src/lib/ingest/sources/rfee-pdf/lectura');
  const { depsEngardeReales } = await import('../src/lib/ingest/sources/engarde');
  const { descubrirEnlacesFie } = await import('../src/lib/ingest/enlaces-resultados');

  const indicesSkermo = new Map<string, Awaited<ReturnType<typeof depsInventarioSkermoRed.parsear>>>();
  async function indiceSkermo(federacion: string, temporada: string) {
    const clave = `${federacion}|${temporada}`;
    const guardado = indicesSkermo.get(clave);
    if (guardado) return guardado;
    const base = await depsInventarioSkermoRed.indice(federacion);
    const opcion = depsInventarioSkermoRed.temporadas(base).find((o) => o.label === temporada);
    if (!opcion) throw new Error(`Skermo/${federacion} no publica la temporada ${temporada}`);
    const html = opcion.selected ? base : await depsInventarioSkermoRed.indice(federacion, opcion.value);
    const indice = depsInventarioSkermoRed.parsear(html, federacion);
    indicesSkermo.set(clave, indice);
    return indice;
  }

  const persistenciaComplemento = crearDepsComplementoDb(db);
  return crearEjecutor({
    fie: {
      lectura: { fetchJson: (url) => fetchJson<unknown>(url, { timeoutMs: 60_000 }) },
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
    },
    skermo: {
      leer: async ({ federacion, season, competitionId }) => {
        const indice = await indiceSkermo(federacion, season);
        const fila = indice.rows.find((r) => r.competitionId === competitionId);
        if (!fila) throw new Error(`La fila ${competitionId} ya no está en el índice de Skermo/${federacion} ${season}`);
        return leerFinalSkermo(fila, { federacion, season }, depsLecturaSkermoRed);
      },
      persistencia: crearDepsPersistenciaSkermoDb(db),
    },
    pdf: { leer: (url) => leerPdfRfee(url), persistencia: crearDepsPersistenciaPdfDb(db) },
    complementarios: {
      engarde: depsEngardeReales,
      persistencia: persistenciaComplemento,
      cargarCanonicas: (rango) => cargarCanonicasDb(db, rango),
      cargarCanonicaPorId: (id) => cargarCanonicaPorIdDb(db, id),
    },
    enlaces: {
      descubrir: (season, competitionId) => descubrirEnlacesFie(depsEngardeReales, season, competitionId),
      persistencia: persistenciaComplemento,
    },
  });
}

const deps: DepsBackfillCli = {
  leerFilas: (filtro) => leerFilasPlan(consultar, filtro),
  leerAgregada: () => leerCoberturaAgregada(consultar),
  leerReferencias: () => contarReferenciasHistoricas(consultar),
  esquema: esquemaDeportivo,
  categoriasAmpliadas: () => categoriasHistoricasAplicadas(),
  medir: () => medirOcupacion(consultar),
  crearEjecutor,
  ahora: () => new Date(),
  dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const resultado = await ejecutarBackfillCli(deps, opciones);
for (const linea of resultado.lineas) console.log(linea);
if (!opciones.aplicar) console.log('Modo simulación: no se ha escrito nada. Añade --aplicar para ejecutar el lote.');
process.exitCode = resultado.codigo;
