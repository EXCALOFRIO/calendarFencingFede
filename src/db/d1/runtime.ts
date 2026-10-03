import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { SQLiteRaw } from 'drizzle-orm/sqlite-core/query-builders/raw';
import * as schema from '../schema';
import { boundedD1Binding, type D1Binding, type D1QueryResult } from './binding';

export type ExecuteResult<T> = { rows: T[] };
const dialect = new SQLiteAsyncDialect();

/** Explicit injection for offline tooling/tests, with no mutable global override. */
export function createD1Database(binding: D1Binding) {
  const client = boundedD1Binding(binding);
  const database = drizzle(client, { schema });

  function execute<T = Record<string, unknown>>(query: SQL): SQLiteRaw<ExecuteResult<T>> {
    const built = dialect.sqlToQuery(query);
    const statement = client.prepare(built.sql);
    const raw = new SQLiteRaw<ExecuteResult<T>>(
      async () => ({ rows: (await statement.bind(...built.params).all<T>()).results }),
      () => query,
      'all',
      dialect,
      (result) => ({ rows: (result as D1QueryResult<T>).results }),
    );
    // SQLiteD1Session.batch expects stmt on each prepared query. SQLiteRaw's
    // _prepare returns itself but does not supply it; provide it explicitly.
    return Object.assign(raw, { stmt: statement });
  }

  return Object.assign(database, {
    execute,
    /** D1 exposes storage through result metadata, not page_count PRAGMAs. */
    async storageSize(): Promise<number> {
      try {
        const result = await client.prepare('SELECT 1 AS storage_probe').all();
        const bytes = result.meta?.size_after;
        if (!result.success || !Number.isSafeInteger(bytes) || bytes <= 0) {
          throw new Error('D1 storage measurement unavailable.');
        }
        return bytes;
      } catch {
        throw new Error('D1 storage measurement unavailable.');
      }
    },
    // Cloudflare D1 forbids SQL BEGIN/SAVEPOINT. Do not imply that Drizzle's
    // interactive SQLite transaction implementation works on the D1 binding.
    transaction: (() => {
      throw new Error('D1 does not support interactive transactions. Use db.batch for an atomic set of bounded statements.');
    }) as typeof database.transaction,
  });
}

export type Db = ReturnType<typeof createD1Database>;

export function resolveD1Binding(): D1Binding {
  let binding: unknown;
  try {
    binding = getCloudflareContext().env.DB;
  } catch {
    throw new Error('Cloudflare D1 DB binding is unavailable in this request. Configure DB or inject a local binding explicitly.');
  }
  if (!binding || typeof binding !== 'object'
    || !('prepare' in binding) || typeof binding.prepare !== 'function'
    || !('batch' in binding) || typeof binding.batch !== 'function') {
    throw new Error('Missing Cloudflare D1 DB binding. PostgreSQL fallback is disabled.');
  }
  return binding as D1Binding;
}

/**
 * Resolve at property access, never at import time, and never cache a
 * request's binding/database in module state. Builders capture their own
 * request-local session. resolve can be injected into an isolated local proxy.
 */
export function createLazyD1Database(resolve: () => D1Binding = resolveD1Binding): Db {
  return new Proxy({} as Db, {
    get(_target, property) {
      const database = createD1Database(resolve());
      const value: unknown = Reflect.get(database, property);
      return typeof value === 'function' ? value.bind(database) : value;
    },
  });
}
