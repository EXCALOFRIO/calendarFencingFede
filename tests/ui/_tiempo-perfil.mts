/**
 * Tiempo de la ficha completa (los mismos cargadores que la página) sobre una
 * copia SQLite de D1 en sólo lectura.
 *
 *   PERF_DB=<copia> npx tsx tests/ui/_tiempo-perfil.mts [personaId...]
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { crearContexto } from '../helpers/explorar';

const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const sqlite = new DatabaseSync(BASE, { readOnly: true });
const lentas: { ms: number; sql: string }[] = [];

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  throw new TypeError(`valor no admitido: ${typeof v}`);
}

function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => D1QueryResult<unknown> } {
  const ejecutar = (): D1QueryResult<unknown> => {
    const t = performance.now();
    const rows = sqlite.prepare(query).all(...values.map(valor));
    lentas.push({ ms: Math.round(performance.now() - t), sql: query.replace(/\s+/g, ' ').slice(0, 90) });
    return { success: true, results: rows, meta: {} } as D1QueryResult<unknown>;
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
const ctx = { ...crearContexto().ctx, db: createD1Database(binding) };

const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  '8bf5062e-5677-4540-b2bc-1ae911cda424',
  '58671832-da43-4fc9-bafa-4354747a347e',
];
for (const id of ids) {
  const mejores: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    lentas.length = 0;
    const t = performance.now();
    const vista = await cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS);
    mejores.push(Math.round(performance.now() - t));
    if (vista.tipo !== 'ok') throw new Error(`${id}: ${vista.tipo}`);
  }
  console.log(id.slice(0, 8), 'ms por vuelta', mejores.join(' / '), 'consultas', lentas.length);
  console.table([...lentas].sort((a, b) => b.ms - a.ms).slice(0, 6));
}
