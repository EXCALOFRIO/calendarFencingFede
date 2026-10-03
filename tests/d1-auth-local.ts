import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/d1';
import { readFileSync } from 'node:fs';

/** Actual SQLite behind the D1 driver surface; never contacts a remote database. */
export function localAuthDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  // Use the preserved application schema, not a hand-written approximation.
  sqlite.exec(readFileSync(new URL('../drizzle-d1/0000_aplicacion.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle-d1/0001_auth.sql', import.meta.url), 'utf8'));
  const state = { beforeQuery: (_sql: string) => {} };
  function prepare(query: string, params: unknown[] = []) {
    const execute = (rows: boolean) => {
      state.beforeQuery(query);
      const statement = sqlite.prepare(query);
      if (rows) {
        statement.setReturnArrays(true);
        return statement.all(...params as never[]);
      }
      return statement.run(...params as never[]);
    };
    return {
      bind: (...values: unknown[]) => prepare(query, values),
      raw: async () => execute(true),
      all: async () => {
        state.beforeQuery(query);
        return { results: sqlite.prepare(query).all(...params as never[]), success: true };
      },
      run: async () => {
        const result = execute(false) as { changes: number };
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
    };
  }
  const db = drizzle({ prepare } as unknown as Parameters<typeof drizzle>[0]);
  return { sqlite, db, state };
}
