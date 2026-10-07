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

type ConSesiones = D1Binding & { withSession(constraint?: string): D1Binding };

/**
 * One D1 Session per request, keyed by OpenNext's request context object (a
 * new object per request, see its `runWithCloudflareRequestContext`).
 */
const sesionesPorPeticion = new WeakMap<object, D1Binding>();

export function resolveD1Binding(): D1Binding {
  let contexto: ReturnType<typeof getCloudflareContext>;
  let binding: unknown;
  try {
    contexto = getCloudflareContext();
    binding = contexto.env.DB;
  } catch {
    throw new Error('Cloudflare D1 DB binding is unavailable in this request. Configure DB or inject a local binding explicitly.');
  }
  if (!binding || typeof binding !== 'object'
    || !('prepare' in binding) || typeof binding.prepare !== 'function'
    || !('batch' in binding) || typeof binding.batch !== 'function') {
    throw new Error('Missing Cloudflare D1 DB binding. PostgreSQL fallback is disabled.');
  }
  // Opt-in read replication (docs/rendimiento.md). Without a bookmark cookie a
  // request may read a replica that has not yet seen the previous request's
  // write (e.g. a new follow), so it stays off until that is in place.
  const modo = (contexto.env as { D1_SESIONES?: unknown }).D1_SESIONES ?? process.env.D1_SESIONES;
  if (modo === 'replicas' && 'withSession' in binding && typeof binding.withSession === 'function') {
    let sesion = sesionesPorPeticion.get(contexto);
    if (!sesion) {
      sesion = (binding as ConSesiones).withSession('first-unconstrained');
      sesionesPorPeticion.set(contexto, sesion);
    }
    return sesion;
  }
  return binding as D1Binding;
}

/**
 * Drizzle with the full schema walks every table to build its relational
 * config (~0.4 ms of CPU); the lazy proxy did that on every property access,
 * i.e. on every query. The cached instance holds nothing but the binding it
 * is keyed by, so it carries no request state.
 */
const databasesPorBinding = new WeakMap<D1Binding, Db>();
function databaseFor(binding: D1Binding): Db {
  let database = databasesPorBinding.get(binding);
  if (!database) {
    database = createD1Database(binding);
    databasesPorBinding.set(binding, database);
  }
  return database;
}

/**
 * Resolve at property access, never at import time. Builders capture the
 * binding resolved when they were created. resolve can be injected into an
 * isolated local proxy.
 */
export function createLazyD1Database(resolve: () => D1Binding = resolveD1Binding): Db {
  return new Proxy({} as Db, {
    get(_target, property) {
      const database = databaseFor(resolve());
      const value: unknown = Reflect.get(database, property);
      return typeof value === 'function' ? value.bind(database) : value;
    },
  });
}
