/** Local CLI only. No request binding, network, migration or Neon fallback. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createD1Database } from '@/db';
import { assertD1Parameters, type D1Binding, type D1QueryResult, type D1Statement } from '@/db/d1/binding';

export function destinoD1Local(args: readonly string[], write: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const indexes = args.flatMap((a, i) => a === '--d1-local' ? [i] : []);
  if (indexes.length !== 1) throw new Error('sport_cli_requires_explicit_d1_local');
  const i = indexes[0], path = args[i + 1];
  if (!path || !isAbsolute(path) || !/\.(sqlite|sqlite3|db)$/i.test(path)) throw new Error('sport_cli_invalid_d1_local');
  if (args.some((a) => /^(--remote|--database-url|--plan-neon|--neon-)/.test(a))) {
    throw new Error('sport_cli_remote_or_neon_refused');
  }
  // Do not let a dotenv DATABASE_URL imply an accidental historical writer.
  if (write && env.DATABASE_URL?.trim()) throw new Error('sport_cli_remove_database_url_before_write');
  const resolved = realpathSync(path);
  if (!statSync(resolved).isFile()) throw new Error('sport_cli_invalid_d1_local');
  return { path: resolved, args: [...args.slice(0, i), ...args.slice(i + 2)] };
}

export function abrirD1Local(path: string, write: boolean) {
  // Existing file only; callers validate before opening. Never create a DB or
  // apply schema here. Production Cloudflare binding is not a CLI default.
  if (!isAbsolute(path) || !statSync(path).isFile()) throw new Error('sport_cli_invalid_d1_local');
  const sqlite = new DatabaseSync(path, { readOnly: !write });
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const executions = new WeakMap<D1Statement, () => D1QueryResult<unknown>>();
  function values(parameters: readonly unknown[]): SQLInputValue[] {
    assertD1Parameters(parameters);
    return parameters.map((v) => {
      if (v === null || typeof v === 'string' || typeof v === 'number') return v;
      if (v instanceof ArrayBuffer) return new Uint8Array(v);
      if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      return new Uint8Array(v as number[]);
    });
  }
  function prepare(query: string, parameters: readonly unknown[] = []): D1Statement {
    const execute = (): D1QueryResult<unknown> => {
      const stmt = sqlite.prepare(query), params = values(parameters);
      const before = Number(sqlite.prepare('select total_changes() as n').get()!.n);
      const returns = stmt.columns().length > 0;
      const rows = returns ? stmt.all(...params) : [];
      const change = returns ? sqlite.prepare('select changes() as changes, last_insert_rowid() as lastInsertRowid').get()! : stmt.run(...params);
      const changed = Number(sqlite.prepare('select total_changes() as n').get()!.n) !== before;
      const changes = changed ? Number(change.changes) : 0;
      return { success: true, results: rows, meta: { duration: 0, changes,
        last_row_id: changed ? Number(change.lastInsertRowid) : 0, changed_db: changed,
        // This LOCAL emulation supplies server metadata. Application SQL must
        // never issue these PRAGMAs: production D1 denies both with SQLITE_AUTH.
        size_after: Number(sqlite.prepare('PRAGMA page_count').get()!.page_count)
          * Number(sqlite.prepare('PRAGMA page_size').get()!.page_size),
        rows_read: rows.length, rows_written: changes } };
    };
    const statement: D1Statement = {
      bind: (...v) => prepare(query, v),
      all: async <T>() => execute() as D1QueryResult<T>,
      run: async <T>() => execute() as D1QueryResult<T>,
      raw: async <T>() => {
        const stmt = sqlite.prepare(query); stmt.setReturnArrays(true);
        return stmt.all(...values(parameters)) as unknown as T[];
      },
      first: async <T>(column?: string) => {
        const row = execute().results[0] as Record<string, unknown> | undefined;
        return (row ? column ? row[column] : row : null) as T | null;
      },
    };
    executions.set(statement, execute);
    return statement;
  }
  const binding: D1Binding = {
    prepare,
    batch: async <T>(statements: D1Statement[]) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map((s) => {
          const run = executions.get(s);
          if (!run) throw new Error('sport_cli_foreign_statement');
          return run() as D1QueryResult<T>;
        });
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db: createD1Database(binding), close: () => sqlite.close() };
}
