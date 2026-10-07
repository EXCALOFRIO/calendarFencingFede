/**
 * Trabajo de servidor del perfil por secciones contra una copia SQLite de D1
 * en sólo lectura: la cabecera (camino crítico, común a todas) y lo que lee
 * cada sección al abrirse. `antes` es la página de una sola pieza, que además
 * empezaba a la vez todas las lecturas diferidas.
 *
 *   $env:PERF_DB=<copia> ; npx tsx tests/ui/_tiempo-secciones.mts [personaId…]
 */
import { DatabaseSync } from 'node:sqlite';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import {
  cargarCuriosidadesPerfil, cargarDiferidosPerfil, cargarEuropeoPerfil, cargarRelevosPerfil,
  cargarRendimientoPerfil, cargarRivalesPerfil,
} from '@/lib/sport/explorar/perfil-diferido';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura, d1DeLectura, type Medida } from './d1-lectura.mts';

const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const sqlite = new DatabaseSync(BASE, { readOnly: true });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : [
  'b40372bf-0b56-4faf-a603-4e0b7f351739',
  '8bf5062e-5677-4540-b2bc-1ae911cda424',
];

async function medir(tarea: (ctx: ReturnType<typeof crearContexto>['ctx']) => Promise<unknown>) {
  let mejor = { ms: Infinity, n: 0, sql: 0 };
  for (let i = 0; i < 3; i++) {
    const medidas: Medida[] = [];
    const ctx = { ...crearContexto().ctx, db: d1DeLectura(sqlite, medidas) };
    (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: bindingDeLectura(sqlite, medidas) }, ctx: {}, cf: {} };
    const t0 = performance.now();
    await tarea(ctx);
    const ms = performance.now() - t0;
    if (ms < mejor.ms) mejor = { ms, n: medidas.length, sql: medidas.reduce((s, m) => s + m.ms, 0) };
  }
  return `${mejor.ms.toFixed(0).padStart(5)} ms, ${String(mejor.n).padStart(2)} sentencias, SQL ${mejor.sql.toFixed(0)} ms`;
}

const cabecera = (ctx: ReturnType<typeof crearContexto>['ctx'], id: string) => Promise.all([
  cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
  cargarExtrasPerfil(ctx, id, { conRendimiento: false }),
]);

for (const id of ids) {
  console.log(`\n${id}`);
  console.log(`  cabecera + Resultados    ${await medir((ctx) => cabecera(ctx, id))}`);
  console.log(`  antes: todo de una vez   ${await medir(async (ctx) => {
    const d = cargarDiferidosPerfil(ctx, id);
    await Promise.all([cabecera(ctx, id), d.rendimiento, d.rivales, d.europeo, d.relevos]);
  })}`);
  console.log(`  sección Estadísticas    ${await medir((ctx) => cargarRendimientoPerfil(ctx, id))}`);
  console.log(`  sección Rivales         ${await medir((ctx) => Promise.all([cargarRivalesPerfil(ctx, id), cargarRelevosPerfil(ctx, id)]))}`);
  console.log(`  sección Curiosidades    ${await medir((ctx) => cargarCuriosidadesPerfil(ctx, id))}`);
  console.log(`  sección Ranking         ${await medir((ctx) => Promise.all([cargarExtrasPerfil(ctx, id, { conRendimiento: false }), cargarEuropeoPerfil(ctx, id)]))}`);
}
sqlite.close();
