import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { sqliteTable } from 'drizzle-orm/sqlite-core';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { db as applicationDb } from '../src/db';
import { createD1Database, createLazyD1Database, resolveD1Binding } from '../src/db/d1/runtime';
import { boundedBatch, parameterBatches } from '../src/db/d1/batching';
import { assertD1Parameters, boundedD1Binding, type D1Binding } from '../src/db/d1/binding';
import { timestampMilliseconds } from '../src/db/d1/columns';
import { localD1 } from '../src/db/d1/testing';
import { athlete, club, configChangeLog, cronExecution, deadlineRule, season, sportIncrementalTask } from '../src/db/schema';

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));

const cleanups: (() => void)[] = [];
function database() {
  const local = localD1();
  cleanups.push(local.close);
  return { ...local, db: createD1Database(local.binding) };
}
afterEach(() => { cleanups.splice(0).forEach((close) => close()); });
beforeEach(() => {
  vi.mocked(getCloudflareContext).mockReset();
  vi.mocked(getCloudflareContext).mockImplementation(() => { throw new Error('No request context'); });
});

describe('D1 runtime and exceptional storage roundtrips', () => {
  it('imports without context and fails closed instead of opening Neon', () => {
    expect(getCloudflareContext).not.toHaveBeenCalled();
    expect(() => applicationDb.select()).toThrow('Cloudflare D1 DB binding is unavailable');
    expect(() => resolveD1Binding()).toThrow('Cloudflare D1 DB binding is unavailable');
    vi.mocked(getCloudflareContext).mockReturnValue({ env: {} } as ReturnType<typeof getCloudflareContext>);
    expect(() => resolveD1Binding()).toThrow('Missing Cloudflare D1 DB binding');
    expect(() => createLazyD1Database(() => { throw new Error('No injected binding'); }).select()).toThrow('No injected binding');
  });

  it('uses request-local bindings and lets an earlier builder retain its own binding', async () => {
    const first = database();
    const second = database();
    await first.db.insert(club).values({ id: 'first', name: 'first' });
    await second.db.insert(club).values({ id: 'second', name: 'second' });
    let current = first.binding;
    const lazy = createLazyD1Database(() => current);
    const earlier = lazy.select({ id: club.id }).from(club);
    current = second.binding;
    expect(await lazy.select({ id: club.id }).from(club)).toEqual([{ id: 'second' }]);
    expect(await earlier).toEqual([{ id: 'first' }]);
    vi.mocked(getCloudflareContext).mockReturnValue({ env: { DB: second.binding } } as ReturnType<typeof getCloudflareContext>);
    expect(await applicationDb.select({ id: club.id }).from(club)).toEqual([{ id: 'second' }]);
  });

  it('roundtrips Date milliseconds, booleans, date-only strings and unchanged IDs', async () => {
    const { db, sqlite } = database();
    const exact = new Date('1969-12-31T23:59:59.123Z');
    await db.insert(athlete).values({
      id: 'original-id', firstName: 'Álex', lastName: 'Ramírez',
      birthDate: '2000-02-29', gender: 'M', active: false, consentSignedAt: exact,
    });
    const [row] = await db.select().from(athlete);
    expect(row).toMatchObject({ id: 'original-id', birthDate: '2000-02-29', active: false, consentSignedAt: exact, clubId: null });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(sqlite.prepare('SELECT active, consent_signed_at, birth_date, typeof(consent_signed_at) AS storage FROM athlete').get())
      .toMatchObject({ active: 0, consent_signed_at: -877, birth_date: '2000-02-29', storage: 'integer' });
    await db.update(athlete).set({ active: true, consentSignedAt: null }).where(eq(athlete.id, 'original-id'));
    expect((await db.select().from(athlete))[0]).toMatchObject({ active: true, consentSignedAt: null });
    const column = sqliteTable('mapping_only', { value: timestampMilliseconds('value') }).value;
    expect(() => column.mapToDriverValue(new Date('invalid'))).toThrow('Invalid D1 timestamp');
    expect(() => column.mapFromDriverValue(1.5)).toThrow('Invalid stored D1 timestamp');
  });

  it('roundtrips JSON objects, arrays, escaped text and SQL null without PG array literals', async () => {
    const { db, sqlite } = database();
    const payload = { nested: { array: [1, null, 'a,b', 'quote"\\', 'niño'] }, value: false };
    await db.insert(sportIncrementalTask).values({ key: 'task', season: '2027', kind: 'fie_index', payload });
    expect((await db.select().from(sportIncrementalTask))[0]).toMatchObject({ payload, attempts: 0, status: 'pendiente', lastCheckedAt: null });
    const stored = sqlite.prepare('SELECT payload, typeof(payload) AS storage FROM sport_incremental_task').get()!;
    expect(stored).toMatchObject({ payload: JSON.stringify(payload), storage: 'text' });
    await db.insert(configChangeLog).values({ tableName: 'sample', rowId: 'exact-id', action: 'update', before: [null, 'x,y'], after: null });
    expect((await db.select().from(configChangeLog))[0]).toMatchObject({ before: [null, 'x,y'], after: null });
    await expect(db.insert(sportIncrementalTask).values({
      key: 'bad', season: '2027', kind: 'fie_index', payload: { big: 1n },
    })).rejects.toThrow();
  });

  it('preserves decimal strings exactly and safe bigint-number values', async () => {
    const { db, sqlite } = database();
    const [localSeason] = await db.insert(season).values({ label: 'local', startDate: '2026-09-01', endDate: '2027-08-31' }).returning();
    await db.insert(deadlineRule).values({
      seasonId: localSeason.id, scope: 'NACIONAL', type: 'L1', label: 'local', daysBefore: 1,
      surchargeEur: '123456.70', weekday: 7, weeksBefore: 1,
    });
    expect((await db.select().from(deadlineRule))[0]).toMatchObject({ surchargeEur: '123456.70', weekday: 7, weeksBefore: 1 });
    expect(sqlite.prepare('SELECT surcharge_eur, typeof(surcharge_eur) AS storage FROM deadline_rule').get())
      .toMatchObject({ surcharge_eur: '123456.70', storage: 'text' });
    await db.insert(cronExecution).values({ task: 'local', scheduledMinute: Number.MAX_SAFE_INTEGER });
    expect((await db.select().from(cronExecution))[0].scheduledMinute).toBe(Number.MAX_SAFE_INTEGER);
    await expect(db.insert(cronExecution).values({ task: 'invalid', scheduledMinute: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow();
  });

  it('executes native SQLite SQL with typed rows and actual DML metadata', async () => {
    const { db } = database();
    expect(await db.execute<{ answer: number; json: string }>(sql`SELECT ${42} AS answer, json_extract(${'{"value":"ok"}'}, '$.value') AS json`))
      .toEqual({ rows: [{ answer: 42, json: 'ok' }] });
    const write = await db.insert(club).values({ id: 'plain', name: 'plain' });
    expect(write.meta.changes).toBe(1);
    expect(await db.execute<{ id: string }>(sql`INSERT INTO club (id, name) VALUES (${'returning'}, ${'returned'}) RETURNING id`))
      .toEqual({ rows: [{ id: 'returning' }] });
    const returningWrite = await db.run(sql`INSERT INTO club (id, name) VALUES (${'metadata'}, ${'metadata'}) RETURNING id`);
    expect(returningWrite.meta).toMatchObject({ changes: 1, changed_db: true, rows_written: 1 });
    expect((await db.run(sql`SELECT id FROM club`)).meta).toMatchObject({ changes: 0, changed_db: false, rows_written: 0 });
  });

  it('measures storage through read-only D1 result metadata', async () => {
    const local = database();
    const expected = Number(local.sqlite.prepare('PRAGMA page_count').get()!.page_count)
      * Number(local.sqlite.prepare('PRAGMA page_size').get()!.page_size);
    expect(await local.db.storageSize()).toBe(expected);
    expect(local.calls).toEqual([{ sql: 'SELECT 1 AS storage_probe', parameters: 0 }]);
  });

  it('fails closed on absent or invalid storage metadata without leaking errors', async () => {
    for (const bytes of [undefined, null, 0, -1, 1.5, Number.NaN]) {
      const binding = {
        prepare: () => ({ all: async () => ({ success: true, meta: { size_after: bytes }, results: [] }) }),
      } as unknown as D1Binding;
      await expect(createD1Database(binding).storageSize()).rejects.toThrow('measurement unavailable');
    }
    const binding = {
      prepare: () => ({ all: async () => { throw new Error('PRIVATE-VALUE'); } }),
    } as unknown as D1Binding;
    await expect(createD1Database(binding).storageSize()).rejects.toThrow(/^D1 storage measurement unavailable\.$/);
  });
});

describe('D1 bounded batching', () => {
  it('supports atomic lazy batches with bound ORM and raw SQL statements', async () => {
    const local = database();
    const db = createLazyD1Database(() => local.binding);
    const results = await db.batch([
      db.insert(club).values({ id: 'bound', name: 'bound' }).returning({ id: club.id }),
      db.execute<{ id: string }>(sql`SELECT id FROM club WHERE id = ${'bound'}`),
      db.execute<{ count: number }>(sql`SELECT count(*) AS count FROM club`),
    ]);
    expect(results).toEqual([[{ id: 'bound' }], { rows: [{ id: 'bound' }] }, { rows: [{ count: 1 }] }]);
    await expect(db.batch([
      db.insert(club).values({ id: 'rolled-back', name: 'first' }),
      db.insert(club).values({ id: 'bound', name: 'duplicate' }),
    ])).rejects.toThrow();
    expect(await db.select({ id: club.id }).from(club).where(eq(club.id, 'rolled-back'))).toEqual([]);
  });

  it('rejects interactive transactions and statements from another binding', async () => {
    const first = database();
    const second = database();
    const callback = vi.fn();
    expect(() => first.db.transaction(callback)).toThrow('D1 does not support interactive transactions');
    expect(callback).not.toHaveBeenCalled();
    await expect(first.db.batch([second.db.insert(club).values({ id: 'foreign', name: 'foreign' })])).rejects.toThrow('same database');
    expect(first.calls).toHaveLength(0);
    expect(second.calls).toHaveLength(0);
  });

  it('enforces parameter and raw serialization limits before sending SQL', async () => {
    const { db, calls } = database();
    assertD1Parameters(Array.from({ length: 100 }, () => 1));
    expect(() => assertD1Parameters(Array.from({ length: 101 }, () => 1))).toThrow('at most 100');
    for (const invalid of [new Date(), true, undefined, {}, NaN, Infinity, [256], ['x']]) {
      expect(() => assertD1Parameters([invalid])).toThrow('Unsupported D1 parameter');
    }
    assertD1Parameters([null, 'text', 0, new ArrayBuffer(1), new Uint8Array([1]), [0, 255]]);
    const values = Array.from({ length: 101 }, (_, i) => sql`${i}`);
    await expect(db.execute(sql`SELECT ${sql.join(values, sql`, `)}`)).rejects.toThrow('at most 100');
    expect(calls).toHaveLength(0);
    await expect(db.execute(sql`SELECT ${new Date()}`)).rejects.toThrow('Unsupported D1 parameter');
    await expect(db.execute(sql`SELECT ${true}`)).rejects.toThrow('Unsupported D1 parameter');
    expect(calls).toHaveLength(0);
  });

  it('budgets insert batches before SQL construction and keeps statement order', async () => {
    const { db, calls } = database();
    const rows = Array.from({ length: 103 }, (_, i) => ({ id: `id-${i}`, name: `name-${i}` }));
    // The omitted active=true scalar default is also a bound parameter.
    const budget = db.insert(club).values(rows[0]).toSQL().params.length;
    expect(budget).toBe(3);
    const groups = parameterBatches(rows, budget);
    expect(groups.map((group) => group.length)).toEqual([33, 33, 33, 4]);
    const queries = groups.map((group) => db.insert(club).values(group).returning({ id: club.id }));
    expect((await boundedBatch(db, queries, 2)).flat().map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(calls.map((call) => call.parameters)).toEqual([99, 99, 99, 12]);
    expect(parameterBatches(rows, 3, 7).map((group) => group.length)).toEqual([31, 31, 31, 10]);
    expect(parameterBatches([], 1)).toEqual([]);
    for (const budget of [0, -1, 1.5, 101]) expect(() => parameterBatches(rows, budget)).toThrow('Invalid D1 parameter budget');
    expect(() => parameterBatches(rows, 1, 100)).toThrow('Invalid D1 parameter budget');
    expect(() => parameterBatches(rows, 1, -1)).toThrow('Invalid D1 parameter budget');
  });

  it('splits independently committable batches but rejects oversized atomic batches', async () => {
    const { db, binding } = database();
    const queries = Array.from({ length: 101 }, (_, i) => db.insert(club).values({ id: `batch-${i}`, name: `${i}` }));
    await expect(db.batch(queries as [typeof queries[number], ...typeof queries[number][]])).rejects.toThrow('1..100 statements');
    const bounded = boundedD1Binding(binding);
    expect(() => bounded.batch([])).toThrow('1..100 statements');
    expect(await boundedBatch(db, [])).toEqual([]);
    await expect(boundedBatch(db, queries, 101)).rejects.toThrow('Invalid D1 statement batch size');
    expect(await boundedBatch(db, queries)).toHaveLength(101);
    expect(await db.select({ count: sql<number>`count(*)` }).from(club)).toEqual([{ count: 101 }]);
    const independent = [
      db.insert(club).values({ id: 'committed', name: 'first' }),
      db.insert(club).values({ id: 'committed', name: 'duplicate' }),
    ];
    await expect(boundedBatch(db, independent, 1)).rejects.toThrow();
    expect(await db.select({ id: club.id }).from(club).where(eq(club.id, 'committed'))).toEqual([{ id: 'committed' }]);
  });
});
