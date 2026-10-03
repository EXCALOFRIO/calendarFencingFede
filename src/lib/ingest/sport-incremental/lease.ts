import { sql, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '@/db';
import { presupuestoD1 } from '../backfill/capacidad-db';
import { verificarEsquemaD1 } from './schema';
import { reservaCapacidad } from './capacity';

export const LEASE_SECONDS = 120;
export const DB_NOW = sql`(cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))`;
// Foundation binding permits 100 including the two context statements.
export const MAX_BATCH_STATEMENTS = 98;
export const MAX_BIND_PARAMS = 100;
const readOnlySql = (text: string) => /^select\b/i.test(text.trim()) ||
  /^pragma (?:table_info\('[a-z_]+'\)|foreign_keys)\s*;?$/i.test(text.trim());
export class SportLeaseLost extends Error {
  constructor() { super('sport_lease_unavailable'); }
}

/** Claims use the database clock and increment a fencing version on reclaim. */
export async function reclamarSportLease(db: Db, owner = crypto.randomUUID()) {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error('sport_owner_invalid');
  await verificarEsquemaD1(db);
  const r = await db.execute(sql`
    insert into sport_write_lease(key,owner,expires_at,lease_version)
    values('global',${owner},${DB_NOW}+${LEASE_SECONDS * 1000},1)
    on conflict(key) do update set owner=excluded.owner,
      expires_at=excluded.expires_at, lease_version=sport_write_lease.lease_version+1
    where sport_write_lease.expires_at <= ${DB_NOW}
    returning owner,lease_version`);
  if (r.rows.length === 0) return null;
  const version = Number(r.rows[0].lease_version);
  if (r.rows[0].owner !== owner || !Number.isSafeInteger(version) || version < 1) throw new SportLeaseLost();
  const renovar = async () => {
    const renewed = await db.execute(sql`update sport_write_lease
      set expires_at=${DB_NOW}+${LEASE_SECONDS * 1000}
      where key='global' and owner=${owner} and lease_version=${version}
        and expires_at>${DB_NOW} returning owner`);
    if (renewed.rows.length !== 1) throw new SportLeaseLost();
  };
  const liberar = async () => {
    await db.execute(sql`update sport_write_lease set expires_at=${DB_NOW}
      where key='global' and owner=${owner} and lease_version=${version}`);
  };
  return { owner, version, renovar, liberar };
}
export type SportLease = NonNullable<Awaited<ReturnType<typeof reclamarSportLease>>>;

/**
 * D1 serializes an entire atomic batch. The context is inserted (owner/version
 * checked by a trigger), every corpus mutation checks it again, then it is
 * removed IN THE SAME BATCH. Rollback restores the initially empty context.
 * No separate set_config, interactive transaction, or active-lease free pass.
 */
export function dbConSportLease(db: Db, lease: SportLease,
  comprobar: () => void | Promise<void> = () => {},
  reservar: (statements: number) => void = () => {},
): Db {
  const raw = new WeakMap<object, BatchItem<'sqlite'>>();
  const dialect = new SQLiteSyncDialect();
  let stopped = false;
  const run = async (queries: readonly BatchItem<'sqlite'>[]) => {
    if (stopped) throw new Error('sport_capacity');
    await comprobar();
    if (!queries.length || queries.length > MAX_BATCH_STATEMENTS) throw new Error('sport_batch_limit');
    const builtQueries = queries.map((q) => {
      const built = dialect.sqlToQuery((q as unknown as { getSQL(): SQL }).getSQL());
      if (built.params.length > MAX_BIND_PARAMS) throw new Error('sport_bind_limit');
      return built;
    });
    const projected = reservaCapacidad(builtQueries);
    // Schema validators may receive the owner facade. A pure read batch must
    // not insert a context and then mistake its own context for a leak.
    if (builtQueries.every((q) => readOnlySql(q.sql))) {
      const [first, ...rest] = queries;
      return db.batch([first, ...rest]);
    }
    const budget = presupuestoD1();
    reservar(queries.length + 2);
    await verificarEsquemaD1(db);
    // Production D1 denies page PRAGMAs. Measure metadata before EVERY batch,
    // then reserve against the ledger atomically. Only actual row-trigger
    // charges plus the batch overhead persist, not unused projection credit.
    // Stale measurements cannot erase prior charges; deletes never refund.
    const measured = await db.storageSize();
    if (!Number.isSafeInteger(measured) || measured <= 0) throw new Error('sport_capacity_measurement_unknown');
    if (measured + projected >= budget) throw new Error('sport_capacity');
    await lease.renovar();
    await comprobar();
    const begin = db.execute(sql`insert into sport_write_context(key,owner,lease_version,budget_bytes,projected_bytes,measured_bytes)
      values('global',${lease.owner},${lease.version},${budget},${projected},${measured})`);
    const end = db.execute(sql`delete from sport_write_context
      where key='global' and owner=${lease.owner} and lease_version=${lease.version}`);
    const results = await db.batch([begin, ...queries, end]);
    try {
      const actual = await db.storageSize();
      const { rows } = await db.execute(sql`select accounted_bytes,blocked from sport_capacity_ledger where key='global'`);
      const accounted = rows[0]?.accounted_bytes;
      if (!Number.isSafeInteger(actual) || actual <= 0 || !Number.isSafeInteger(accounted) ||
        rows[0]?.blocked !== 0 || actual > Number(accounted) || actual >= budget) throw new Error();
    } catch {
      // Metadata is available only AFTER commit; do not claim rollback here.
      // Fail visibly and permanently close the ledger, including future
      // owners. A separate in-process latch also stops if this write fails.
      stopped = true;
      try {
        await db.execute(sql`update sport_capacity_ledger set blocked=1 where key='global'`);
      } catch { throw new Error('sport_capacity_postcommit_unverified_block_failed'); }
      throw new Error('sport_capacity_postcommit_unverified');
    }
    return results.slice(1, -1);
  };
  const wrap = (query: object): object => {
    const proxy = new Proxy(query, {
      get(target, prop) {
        if (['then', 'execute', 'run', 'all', 'get', 'values'].includes(String(prop)) &&
          typeof Reflect.get(target, prop) === 'function' && typeof Reflect.get(target, 'getSQL') === 'function') {
          const execute = async () => {
            const [result] = await run([target as BatchItem<'sqlite'>]);
            return result;
          };
          return prop === 'then'
            ? (resolve: (x: unknown) => unknown, reject: (e: unknown) => unknown) => execute().then(resolve, reject)
            : execute;
        }
        // Drizzle batch preparation needs the original query, never an executing proxy.
        if (prop === '_prepare' || prop === 'getSQL' || prop === 'toSQL') {
          return Reflect.get(target, prop)?.bind(target);
        }
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result && typeof result === 'object' ? wrap(result) : result;
        };
      },
    });
    raw.set(proxy, query as BatchItem<'sqlite'>);
    return proxy;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'batch') return (queries: BatchItem<'sqlite'>[]) => run(queries.map((q) => raw.get(q) ?? q));
      if (prop === 'transaction') return () => { throw new Error('sport_interactive_transaction_unsupported'); };
      if (prop === 'run' || prop === 'all' || prop === 'get' || prop === 'values') {
        // Foundation execute supplies a prepared D1 statement for raw batches.
        // Drizzle's other raw SQLiteRaw helpers do not. Never bypass the fence.
        return () => { throw new Error('sport_raw_use_execute'); };
      }
      if (prop === 'insert' || prop === 'update' || prop === 'delete') {
        return (...args: unknown[]) => wrap((Reflect.get(target, prop) as (...a: unknown[]) => object).apply(target, args));
      }
      if (prop === 'execute') return (query: SQL) => {
        const text = dialect.sqlToQuery(query).sql.trim();
        if (readOnlySql(text)) {
          return target.execute(query);
        }
        return wrap(target.execute(query));
      };
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
