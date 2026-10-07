/**
 * Base común de los arneses de Explorar: la copia SQLite abierta en sólo
 * lectura detrás de un D1 de mentira, las personas seguidas en una tabla TEMP
 * y contextos de cuenta. Cuenta las sentencias que llegan a la base para que
 * los arneses puedan decir cuántas consultas hace cada pantalla.
 *
 *   PERF_DB=<copia SQLite de D1>
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { filas } from '@/lib/sport/explorar/contexto';
import { SENTENCIAS_INDICE } from '@/lib/sport/explorar/indice-sql';
import { sqlDestacadosRanking } from '@/lib/sport/explorar/siguiendo-pantalla';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { crearContexto, perfil } from '../helpers/explorar';

export const RAIZ = process.cwd();
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

export const CUENTA = '00000000-0000-4000-8000-0000000000a1';
/** Sin nadie seguido: el feed vacío con propuestas. */
export const CUENTA_NUEVA = '00000000-0000-4000-8000-0000000000a2';
/** Sigue a 60 personas: la carga de una cuenta muy activa. */
export const CUENTA_MUCHAS = '00000000-0000-4000-8000-0000000000a3';
export const ZABALA = process.env.PERSONA_SEGUIDA ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';

export const sqlite = new DatabaseSync(BASE, { readOnly: true });
sqlite.exec('CREATE TEMP TABLE sport_favorite (profile_id TEXT NOT NULL, person_id TEXT NOT NULL, created_at INTEGER NOT NULL)');
sqlite.exec('CREATE UNIQUE INDEX temp.sport_favorite_pk ON sport_favorite (profile_id, person_id)');

const tieneIndice = Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'explorar_indice_estado'").get());
if (!tieneIndice && !process.env.SIN_INDICE) {
  const t = performance.now();
  const ddl = readFileSync(path.join(RAIZ, 'drizzle-d1', '0004_indice_explorar.sql'), 'utf8')
    .replace(/CREATE TABLE /g, 'CREATE TEMP TABLE ')
    .replace(/CREATE UNIQUE INDEX (\w+) ON/g, 'CREATE UNIQUE INDEX temp.$1 ON');
  sqlite.exec(ddl);
  sqlite.exec('BEGIN');
  for (const s of SENTENCIAS_INDICE) sqlite.exec(s);
  sqlite.exec('COMMIT');
  console.log(`índice TEMP construido en ${Math.round(performance.now() - t)} ms`);
}
const conIndice = tieneIndice || !process.env.SIN_INDICE;

/** Sentencias ejecutadas desde el arranque (las del arnés no pasan por aquí). */
export const contador = { sentencias: 0 };

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  throw new TypeError(`valor no admitido: ${typeof v}`);
}
function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => D1QueryResult<unknown> } {
  const ejecutar = (): D1QueryResult<unknown> => {
    if (!/^\s*(SELECT|WITH)\b/i.test(query)) throw new Error(`sólo lectura: ${query.slice(0, 60)}`);
    contador.sentencias++;
    const rows = sqlite.prepare(query).all(...values.map(valor));
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

export const contexto = (profileId: string) => ({
  ...crearContexto({ perfil: perfil({ profileId, role: 'coach' }) }).ctx,
  db: createD1Database(binding),
  indiceExplorar: async () => conIndice,
});
export type Ctx = ReturnType<typeof contexto>;

export const ctx = contexto(CUENTA);
export const ctxNueva = contexto(CUENTA_NUEVA);
export const ctxMuchas = contexto(CUENTA_MUCHAS);

export type Reciente = { id: string; nombre: string; pais: string | null };

async function primero(q: string): Promise<Reciente> {
  const r = await sugerirPersonas(ctx, { q });
  if (r.estado !== 'ok' || !r.items[0]) throw new Error(`sin perfil para ${q}`);
  const { id, nombre, pais } = r.items[0];
  return { id, nombre, pais };
}

/** Perfiles que el navegador recuerda como «recientes» en las capturas. */
export const recientes = [await primero('jorgensen patrick'), await primero('limardo gascon'), await primero('cheung ka long')];

const seguir = sqlite.prepare('INSERT OR IGNORE INTO temp.sport_favorite VALUES (?, ?, ?)');
[ZABALA, ...recientes.map((r) => r.id)].forEach((id, i) => seguir.run(CUENTA, id, 1_700_000_000_000 + i));

/** Los 60 primeros del ranking FIE español y, por si no llegan, los recientes. */
{
  const destacados = filas<{ id: string }>(await ctx.db.execute(sqlDestacadosRanking(60)));
  const top = sqlite.prepare(`
    SELECT DISTINCT coalesce(per.merged_into_person_id, per.id) AS id
    FROM sport_ranking_publication p
    JOIN sport_ranking_entry e ON e.publication_id = p.id
    JOIN sport_person per ON per.id = e.person_id
    WHERE p.source = 'fie_tiradores' AND p.category = 'ABS' AND p.format = 'INDIVIDUAL' AND e.position BETWEEN 1 AND 8
    LIMIT 80`).all() as { id: string }[];
  [...new Set([ZABALA, ...recientes.map((r) => r.id), ...destacados.map((f) => f.id), ...top.map((f) => f.id)])].slice(0, 60)
    .forEach((id, i) => seguir.run(CUENTA_MUCHAS, id, 1_700_000_000_000 + i));
}

export const seguidasDe = (profileId: string) =>
  Number((sqlite.prepare('SELECT count(*) AS n FROM temp.sport_favorite WHERE profile_id = ?').get(profileId) as { n: number }).n);
