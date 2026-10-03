/**
 * Offline test adapter only. Never import from application runtime.
 * Uses Node's built-in SQLite, no Wrangler persistence or external service.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  assertD1Parameters, type D1Binding, type D1Statement, type D1QueryResult,
} from './binding';

function sqliteValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  throw new TypeError('Unsupported local SQLite value.');
}

export function localD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync(new URL('../../../drizzle-d1/0000_aplicacion.sql', import.meta.url), 'utf8'));
  const calls: { sql: string; parameters: number }[] = [];
  const executions = new WeakMap<D1Statement, () => D1QueryResult<unknown>>();

  function statement(query: string, values: unknown[] = []): D1Statement {
    const execute = (): D1QueryResult<unknown> => {
      assertD1Parameters(values);
      calls.push({ sql: query, parameters: values.length });
      const prepared = sqlite.prepare(query);
      const parameters = values.map(sqliteValue);
      const returnsRows = prepared.columns().length > 0;
      const before = returnsRows ? sqlite.prepare('SELECT total_changes() AS total').get()!.total : 0;
      const rows = returnsRows ? prepared.all(...parameters) : [];
      const change = returnsRows
        ? sqlite.prepare('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid, total_changes() AS total').get()!
        : prepared.run(...parameters);
      // SELECT must not inherit a preceding write's changes(). Conversely,
      // INSERT/UPDATE/DELETE RETURNING must report their write, without running
      // the statement twice just to obtain metadata.
      const changed = returnsRows ? 'total' in change && change.total !== before : Boolean(change.changes);
      const changes = changed ? Number(change.changes) : 0;
      return {
        success: true, results: rows,
        meta: {
          duration: 0, changes, last_row_id: changed ? Number(change.lastInsertRowid) : 0,
          changed_db: changed,
          size_after: Number(sqlite.prepare('PRAGMA page_count').get()!.page_count)
            * Number(sqlite.prepare('PRAGMA page_size').get()!.page_size),
          rows_read: rows.length, rows_written: changes,
        },
      };
    };
    const result: D1Statement = {
      bind: (...parameters) => statement(query, parameters),
      all: async <T>() => execute() as D1QueryResult<T>,
      run: async <T>() => execute() as D1QueryResult<T>,
      raw: async <T>() => {
        assertD1Parameters(values);
        calls.push({ sql: query, parameters: values.length });
        const prepared = sqlite.prepare(query);
        prepared.setReturnArrays(true);
        return prepared.all(...values.map(sqliteValue)) as unknown as T[];
      },
      first: async <T>(column?: string) => {
        const row = execute().results[0] as Record<string, unknown> | undefined;
        return (row ? column ? row[column] : row : null) as T | null;
      },
    };
    executions.set(result, execute);
    return result;
  }

  const binding: D1Binding = {
    prepare: (query) => statement(query),
    batch: async <T>(statements: D1Statement[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((item) => {
          const execute = executions.get(item);
          if (!execute) throw new Error('Foreign test statement.');
          return execute() as D1QueryResult<T>;
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, binding, calls, close: () => sqlite.close() };
}
