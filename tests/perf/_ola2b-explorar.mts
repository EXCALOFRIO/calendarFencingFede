/**
 * Medida rápida (ola 2B de Explorar) de los cargadores de Explorar contra la
 * copia SQLite en sólo lectura: cada sentencia con su tiempo y su plan.
 *
 *   PERF_DB=<copia> npx tsx tests/perf/_ola2b-explorar.mts <que> [args]
 *   que = rivales <personaId> | catalogo | podios <eventoId> | buscar-vacio <profileId>
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { createD1Database } from '@/db/d1/runtime';
import { crearContexto } from '../helpers/explorar';

const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const sqlite = new DatabaseSync(BASE, { readOnly: true });
const registro: { sql: string; ms: number; filas: number; plan: string[] }[] = [];

const valor = (v: unknown): SQLInputValue => (v === null || typeof v === 'string' || typeof v === 'number' ? v : String(v));

function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => D1QueryResult<unknown> } {
  const ejecutar = (): D1QueryResult<unknown> => {
    const t = performance.now();
    const rows = sqlite.prepare(query).all(...values.map(valor));
    const ms = performance.now() - t;
    const plan = (sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...values.map(valor)) as { detail: string }[]).map((p) => p.detail);
    registro.push({ sql: query.replace(/\s+/g, ' ').slice(0, 160), ms, filas: rows.length, plan });
    return { success: true, results: rows, meta: { duration: ms, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 } } as D1QueryResult<unknown>;
  };
  return {
    _x: ejecutar,
    bind: (...p: unknown[]) => sentencia(query, p),
    all: async <T>() => ejecutar() as D1QueryResult<T>,
    run: async <T>() => ejecutar() as D1QueryResult<T>,
    raw: async <T>() => ejecutar().results.map((x) => Object.values(x as object)) as unknown as T[],
    first: async <T>(columna?: string) => {
      const fila = ejecutar().results[0] as Record<string, unknown> | undefined;
      return (fila ? (columna ? fila[columna] : fila) : null) as T | null;
    },
  } as never;
}

const binding: D1Binding = {
  prepare: (q) => sentencia(q),
  batch: async <T>(sts: D1Statement[]) => sts.map((s) => (s as unknown as { _x: () => D1QueryResult<T> })._x()),
};
const base = crearContexto().ctx;
const ctx = { ...base, db: createD1Database(binding), indiceExplorar: async () => true };

const [que, arg] = process.argv.slice(2);
const t0 = performance.now();
let resumen: unknown;
if (que === 'rivales') {
  const { listarRivales } = await import('@/lib/sport/explorar/cara-a-cara');
  const r = await listarRivales(ctx, { personaId: arg });
  resumen = r.estado === 'ok' ? { estado: r.estado, rivales: r.items.length, primero: r.items[0] } : r;
} else if (que === 'catalogo') {
  const { leerCatalogoEdiciones } = await import('@/lib/sport/explorar/catalogo');
  const r = await leerCatalogoEdiciones(ctx, {});
  resumen = r.estado === 'ok' ? { total: r.total, pruebas: r.pruebas, primeras: r.ediciones.slice(0, 3).map((e) => [e.inicio, e.id]), siguiente: Boolean(r.siguiente) } : r;
  if (r.estado === 'ok' && r.siguiente) {
    const r2 = await leerCatalogoEdiciones(ctx, { cursor: r.siguiente });
    resumen = { ...(resumen as object), pagina2: r2.estado === 'ok' ? r2.ediciones.slice(0, 3).map((e) => [e.inicio, e.id]) : r2 };
  }
} else if (que === 'edicion' || que === 'edicion-pruebas') {
  // Lo que `cargarPodiosEvento` lee de cada edición casada por clave.
  const { leerEdicion } = await import('@/lib/sport/explorar/ediciones');
  const r = await leerEdicion(ctx, { edicionId: arg }, { soloPruebas: que === 'edicion-pruebas' });
  resumen = r.estado === 'ok' ? { pruebas: r.edicion.pruebasDetalle.length, clasificacion: r.edicion.clasificacion?.filas.length ?? null } : r;
} else {
  throw new Error(`¿${que}?`);
}
const total = performance.now() - t0;
for (const r of registro) {
  console.log(`${r.ms.toFixed(1).padStart(8)} ms ${String(r.filas).padStart(6)} filas  ${r.sql}`);
  for (const p of r.plan) console.log(`${' '.repeat(26)}${p}`);
}
console.log(`\n${registro.length} sentencias, ${total.toFixed(0)} ms en total`);
console.log(JSON.stringify(resumen, null, 1).slice(0, 1500));
