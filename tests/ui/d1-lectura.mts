/**
 * Enlace D1 de sólo lectura sobre un `DatabaseSync` para los arneses sin
 * servidor, con medición opcional del tiempo de cada sentencia.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';

export type Medida = { sql: string; ms: number; filas: number; params: SQLInputValue[] };

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  throw new TypeError(`valor no admitido: ${typeof v}`);
}

export function d1DeLectura(sqlite: DatabaseSync, medidas?: Medida[]) {
  return createD1Database(bindingDeLectura(sqlite, medidas));
}

/** El enlace crudo, para colgarlo del contexto de Cloudflare (consultas con el `db` global). */
export function bindingDeLectura(sqlite: DatabaseSync, medidas?: Medida[]): D1Binding {
  function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => D1QueryResult<unknown> } {
    const ejecutar = (): D1QueryResult<unknown> => {
      const t0 = performance.now();
      const rows = sqlite.prepare(query).all(...values.map(valor));
      medidas?.push({ sql: query, ms: performance.now() - t0, filas: rows.length, params: values.map(valor) });
      return { success: true, results: rows, meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 } } as D1QueryResult<unknown>;
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
  return binding;
}
