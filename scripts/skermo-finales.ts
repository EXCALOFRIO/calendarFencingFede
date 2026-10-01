import 'dotenv/config';
import { depsInventarioSkermoRed, depsLecturaSkermoRed } from '../src/lib/ingest/historico-red';
import { clavePruebaSkermo, claveImportacion, fuenteDeFederacionSkermo } from '../src/lib/ingest/sources/historico-indice';
import { leerFinalSkermo, type LecturaSkermo } from '../src/lib/ingest/sources/skermo-finales';

/**
 * Puestos finales de Skermo de UNA federación y temporada del selector:
 *
 *   npm run skermo-finales -- RFEE 2022-2023 --max 5            -> lectura y resumen, no escribe
 *   npm run skermo-finales -- RFEE 2022-2023 --max 5 --aplicar  -> además guarda en la base
 *
 * La temporada se lee del selector de la propia fuente, no del año civil. Sin
 * `--aplicar` sólo hace GET públicos y muestra recuentos, sin nombres.
 * `--aplicar` omite las pruebas ya importadas (salvo `--releer`) y exige el
 * esquema 0017 aplicado por el propietario. `--max` aplaza, no recorta.
 */

const args = process.argv.slice(2);
const [federacion, temporada] = args.filter((a) => !a.startsWith('--') && Number.isNaN(Number(a)));
const maxArg = args.indexOf('--max');
const max = maxArg >= 0 ? Number(args[maxArg + 1]) : 10;
const aplicar = args.includes('--aplicar');
const releer = args.includes('--releer');

if (!federacion || !temporada || !Number.isInteger(max) || max < 1) {
  console.error('Uso: npm run skermo-finales -- <FED> <AAAA-AAAA> [--max N] [--aplicar] [--releer]');
  process.exit(1);
}

const base = await depsInventarioSkermoRed.indice(federacion);
const opcion = depsInventarioSkermoRed.temporadas(base).find((o) => o.label === temporada);
if (!opcion) {
  console.error(`Skermo/${federacion} no publica la temporada ${temporada}.`);
  process.exit(1);
}
const html = opcion.selected ? base : await depsInventarioSkermoRed.indice(federacion, opcion.value);
const indice = depsInventarioSkermoRed.parsear(html, federacion);
const conHtml = indice.rows.filter((r) => r.competitionId);
console.log(
  `Skermo ${federacion} ${temporada}: filas=${indice.rowsSeen} descuadradas=${indice.mismatches} con clasificación HTML=${conHtml.length}`,
);

let importadas = new Set<string>();
let persistencia: Awaited<ReturnType<typeof preparar>> | null = null;
async function preparar() {
  const { db } = await import('../src/db');
  const { esquemaDeportivo } = await import('../src/lib/sport/esquema-db');
  const { clavesImportadas } = await import('../src/lib/ingest/inventario-historico-db');
  const { crearDepsPersistenciaSkermoDb } = await import('../src/lib/ingest/skermo-finales-db');
  const { persistirLecturaSkermo } = await import('../src/lib/ingest/skermo-finales-persist');
  if (!(await esquemaDeportivo()).identidad) return null;
  return {
    deps: crearDepsPersistenciaSkermoDb(db),
    persistir: persistirLecturaSkermo,
    importadas: await clavesImportadas(db),
  };
}
if (aplicar) {
  persistencia = await preparar();
  if (!persistencia) {
    console.log('El esquema deportivo (migración 0017) no está aplicado: no se escribió nada.');
    process.exit(2);
  }
  importadas = persistencia.importadas;
}

const fuente = fuenteDeFederacionSkermo(federacion);
const pendientes = conHtml.filter(
  (r) => releer || !importadas.has(claveImportacion(fuente, temporada, clavePruebaSkermo(federacion, r.competitionId as string))),
);
const lote = pendientes.slice(0, max);
const estados: Record<string, number> = {};
let puestos = 0;
for (const fila of lote) {
  const lectura: LecturaSkermo = await leerFinalSkermo(fila, { federacion, season: temporada }, depsLecturaSkermoRed);
  estados[lectura.cobertura.estado] = (estados[lectura.cobertura.estado] ?? 0) + 1;
  puestos += lectura.puestos.length;
  if (persistencia) await persistencia.persistir(persistencia.deps, lectura);
  await new Promise((r) => setTimeout(r, 300));
}
console.log(
  `Leídas ${lote.length} de ${pendientes.length} pendientes: estados=${JSON.stringify(estados)} puestos=${puestos}` +
    (pendientes.length > lote.length ? ` (quedan ${pendientes.length - lote.length} para otra ejecución)` : ''),
);
if (!aplicar) console.log('Modo lectura: no se ha escrito nada. Añade --aplicar para guardar.');
