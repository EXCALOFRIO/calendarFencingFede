import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle as legacyQueryBuilder } from 'drizzle-orm/neon-http';
import { sportRankingPublication as legacyPublication } from '../src/db/schema/sport';
import { createD1Database } from '../src/db';
import { localD1 } from '../src/db/d1/testing';
import { sportBout, sportCompetition, sportEdition, sportExternalId, sportIncrementalTask, sportPerson, sportRankingEntry, sportRankingPublication, sportResult } from '../src/db/schema';
import { dbConSportLease, reclamarSportLease, MAX_BATCH_STATEMENTS } from '../src/lib/ingest/sport-incremental/lease';
import { verificarEsquemaD1 } from '../src/lib/ingest/sport-incremental/schema';
import { reservaCapacidad, CAPACITY_BATCH_OVERHEAD } from '../src/lib/ingest/sport-incremental/capacity';
import { comprobarCapacidadD1, D1_DEFAULT_BUDGET_BYTES, medirOcupacion, presupuestoD1 } from '../src/lib/ingest/backfill/capacidad-db';
import { escribirAsaltos, escribirCobertura, escribirResultados } from '../src/lib/ingest/fie-resultados-db';
import { crearDepsPersistenciaRankingDb, escribirPublicacion, MAX_RANKING_ENTRIES_D1 } from '../src/lib/ingest/ranking-oficial-db';
import { crearDepsPersistenciaPdfDb } from '../src/lib/ingest/backfill/pdf-db';
import { crearDepsIncrementoDb } from '../src/lib/ingest/sport-incremental/db';
import { comprobarCooldownD1 } from '../src/lib/ingest/sport-incremental/cooldown';
import { crearGuardIdentidadD1 } from '../src/lib/ingest/backfill/identidad-db';
import { persistirLecturaRanking } from '../src/lib/ingest/ranking-oficial-persist';
import { leerRankingRfee } from '../src/lib/ingest/sources/ranking-oficial-historico';
import { PresupuestoIncremento } from '../src/lib/ingest/sport-incremental/policy';
import type { FilaResultado } from '../src/lib/ingest/fie-resultados-persist';
import type { PublicacionRanking } from '../src/lib/ingest/sources/ranking-oficial-historico';

const cleanups: (() => void)[] = [];
function fixture(fence = true) {
  const local = localD1();
  if (fence) {
    local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0002_guardia_deportiva.sql', import.meta.url), 'utf8'));
    local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0005_presupuesto_8gib.sql', import.meta.url), 'utf8'));
  }
  cleanups.push(local.close);
  return { ...local, db: createD1Database(local.binding) };
}
async function owned() {
  const f = fixture(), lease = await reclamarSportLease(f.db);
  expect(lease).not.toBeNull();
  return { ...f, lease: lease!, writer: dbConSportLease(f.db, lease!) };
}
async function competition(writer: ReturnType<typeof createD1Database>, source = 'fie', key = 'one') {
  const [edition] = await writer.insert(sportEdition).values({ source, season: '2027', tournamentKey: key, name: 'Fixture' }).returning();
  const [c] = await writer.insert(sportCompetition).values({
    source, season: '2027', competitionKey: key, editionId: edition.id,
    weapon: 'ESPADA', gender: 'M', category: 'ABS', format: 'INDIVIDUAL',
  }).returning();
  return c.id;
}
const row = (key = '1', position = 1): FilaResultado => ({
  sourceFactKey: key, personId: null, sourceName: 'Fixture', sourceCountryCode: 'ESP',
  sourceClub: null, position, positionRaw: String(position), officialPoints: '1.250',
  occurredOn: '2026-09-01', sourceUrl: 'https://example.invalid/fixture', contentHash: `hash-${key}-${position}`,
});
const publication = (day = '2026-10-03'): PublicacionRanking => ({
  fuente: 'skermo_ranking', season: '2026-2027', arma: 'ESPADA', genero: 'M',
  categoria: 'ABS', categoriaOriginal: 'ABS', formato: 'INDIVIDUAL',
  publicadoEl: day, url: 'https://example.invalid/fixture', total: 2, entradas: [],
});
const entry = (ref: string, position = 1) => ({ sourceRef: ref, personId: null,
  sourceName: 'Fixture', countryCode: 'ESP', position, points: '1.250' });
afterEach(() => { cleanups.splice(0).forEach((close) => close()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('native D1 sport lease and atomic owner fence', () => {
  it('fails closed on missing, changed guards, foreign keys or leaked context', async () => {
    const missing = fixture(false);
    await expect(reclamarSportLease(missing.db)).rejects.toThrow('sport_migration_required');
    const f = fixture();
    await verificarEsquemaD1(f.db);
    f.sqlite.exec("DROP VIEW sport_write_authorized; CREATE VIEW sport_write_authorized AS SELECT 1 AS ok");
    await expect(reclamarSportLease(f.db)).rejects.toThrow('sport_migration_required');
    const fk = fixture(); fk.sqlite.exec('PRAGMA foreign_keys=OFF');
    await expect(reclamarSportLease(fk.db)).rejects.toThrow('sport_migration_required');
    const leaked = await owned();
    await leaked.db.execute(sql`insert into sport_write_context(key,owner,lease_version,budget_bytes,projected_bytes,measured_bytes)
      values('global',${leaked.lease.owner},${leaked.lease.version},${D1_DEFAULT_BUDGET_BYTES},${CAPACITY_BATCH_OVERHEAD},${await leaked.db.storageSize()})`);
    await expect(reclamarSportLease(leaked.db)).rejects.toThrow('sport_migration_required');
    await expect(leaked.writer.insert(sportPerson).values({ displayName: 'Blocked', nameNormalized: 'blocked' }))
      .rejects.toThrow('sport_migration_required');
    const changed = await owned();
    changed.sqlite.exec('DROP TRIGGER sport_fence_sport_person_insert');
    await expect(changed.writer.insert(sportPerson).values({ displayName: 'Blocked', nameNormalized: 'blocked' }))
      .rejects.toThrow('sport_migration_required');
    const charge = fixture();
    charge.sqlite.exec('DROP TRIGGER sport_charge_sport_person_update');
    await expect(reclamarSportLease(charge.db)).rejects.toThrow('sport_migration_required');
    const columns = fixture();
    columns.sqlite.exec('ALTER TABLE sport_person ADD COLUMN unaccounted TEXT');
    await expect(reclamarSportLease(columns.db)).rejects.toThrow('sport_migration_required');
    const ledger = fixture();
    ledger.sqlite.exec('DROP TRIGGER sport_ledger_update; CREATE TRIGGER sport_ledger_update BEFORE UPDATE ON sport_capacity_ledger BEGIN SELECT 1; END');
    await expect(reclamarSportLease(ledger.db)).rejects.toThrow('sport_migration_required');
  });
  it('one owner wins; an active lease never authorizes uncoordinated ORM/raw writes', async () => {
    const { db, writer, lease } = await owned();
    expect(await reclamarSportLease(db)).toBeNull();
    await expect(db.insert(sportPerson).values({ displayName: 'Fixture', nameNormalized: 'fixture' })).rejects.toThrow();
    await expect(db.execute(sql`insert into sport_person(display_name,name_normalized) values('Fixture','fixture')`)).rejects.toThrow();
    await writer.insert(sportPerson).values({ displayName: 'Fixture', nameNormalized: 'fixture' });
    expect((await db.execute(sql`select count(*) as n from sport_write_context`)).rows[0].n).toBe(0);
    await lease.liberar();
  });
  it('rejects expiry, reclaim and stale renewal/release by owner AND version', async () => {
    const { db, writer, lease, sqlite } = await owned();
    sqlite.prepare("update sport_write_lease set expires_at=0 where key='global'").run();
    await expect(lease.renovar()).rejects.toThrow('sport_lease_unavailable');
    const next = await reclamarSportLease(db);
    expect(next!.version).toBe(lease.version + 1);
    await expect(writer.insert(sportPerson).values({ displayName: 'Old', nameNormalized: 'old' })).rejects.toThrow();
    await lease.liberar();
    expect(sqlite.prepare('select owner,expires_at from sport_write_lease').get()!.owner).toBe(next!.owner);
    await dbConSportLease(db, next!).insert(sportPerson).values({ displayName: 'New', nameNormalized: 'new' });
    await expect(db.execute(sql`insert into sport_write_context(key,owner,lease_version)
      values('global',${lease.owner},${lease.version})`)).rejects.toThrow();
    await next!.liberar();
  });
  it('version fences a reclaimed lease even if an explicit caller reuses its owner token', async () => {
    const { db, writer, lease, sqlite } = await owned();
    sqlite.prepare("update sport_write_lease set expires_at=0 where key='global'").run();
    const next = await reclamarSportLease(db, lease.owner);
    expect(next!.owner).toBe(lease.owner);
    expect(next!.version).toBe(lease.version + 1);
    await expect(writer.insert(sportPerson).values({ displayName: 'Old', nameNormalized: 'old' })).rejects.toThrow();
    await lease.liberar();
    await dbConSportLease(db, next!).insert(sportPerson).values({ displayName: 'New', nameNormalized: 'new' });
  });
  it('clears context on commit and rollback; a mid-batch expiry rolls back all facts', async () => {
    const { db, writer, sqlite } = await owned();
    const insert = () => writer.insert(sportPerson).values({ id: 'same', displayName: 'Fixture', nameNormalized: 'fixture' });
    await expect(writer.batch([insert(), insert()])).rejects.toThrow();
    expect((await db.select().from(sportPerson))).toEqual([]);
    expect(sqlite.prepare('select count(*) as n from sport_write_context').get()!.n).toBe(0);
    await expect(writer.batch([
      insert(),
      writer.execute(sql`update sport_write_lease set expires_at=0 where key='global'`),
      writer.insert(sportPerson).values({ displayName: 'Expired', nameNormalized: 'expired' }),
    ])).rejects.toThrow();
    expect((await db.select().from(sportPerson))).toEqual([]);
    expect(sqlite.prepare('select count(*) as n from sport_write_context').get()!.n).toBe(0);
    await expect(writer.batch([
      insert(), writer.execute(sql`update sport_write_lease set expires_at=0 where key='global'`),
    ])).rejects.toThrow(); // expiry after the last fact is rejected by context close
    expect((await db.select().from(sportPerson))).toEqual([]);
    await insert();
    await expect(db.insert(sportPerson).values({ displayName: 'Other', nameNormalized: 'other' })).rejects.toThrow();
  });
  it('raw epochms CTE writes return rows; foreign-key failures roll back context and facts', async () => {
    const { db, writer, sqlite } = await owned();
    expect(await writer.execute(sql`with value(n) as (select ${1234}) insert into sport_person
      (id,display_name,name_normalized,created_at,updated_at) select 'raw','Raw','raw',n,n from value returning id`))
      .toEqual({ rows: [{ id: 'raw' }] });
    await expect(writer.batch([
      writer.insert(sportPerson).values({ id: 'fk-rollback', displayName: 'Fixture', nameNormalized: 'fixture' }),
      writer.insert(sportRankingEntry).values({ publicationId: 'missing', sourceRef: 'missing' }),
    ])).rejects.toThrow();
    expect(await db.select().from(sportPerson).where(eq(sportPerson.id, 'fk-rollback'))).toEqual([]);
    expect(sqlite.prepare('select count(*) as n from sport_write_context').get()!.n).toBe(0);
  });
  it('bounds every statement and batch BEFORE SQL dispatch', async () => {
    const { writer, calls } = await owned();
    calls.length = 0;
    const tooMany = Array.from({ length: MAX_BATCH_STATEMENTS + 1 }, () => writer.execute(sql`select 1`));
    await expect(writer.batch(tooMany as [typeof tooMany[number], ...typeof tooMany[number][]])).rejects.toThrow('sport_batch_limit');
    await expect(writer.execute(sql`select ${sql.join(Array.from({ length: 101 }, (_, i) => sql`${i}`), sql`,`)}`))
      .rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it('reserves the complete atomic batch against the shared per-run write limit', async () => {
    const { db, lease } = await owned(), budget = new PresupuestoIncremento();
    const writer = dbConSportLease(db, lease, budget.comprobar, budget.reservarEscrituras);
    budget.reservarEscrituras(997);
    await writer.insert(sportPerson).values({ displayName: 'First', nameNormalized: 'first' });
    expect(budget.writeStatements).toBe(1000);
    await expect(writer.insert(sportPerson).values({ displayName: 'Blocked', nameNormalized: 'blocked' }))
      .rejects.toMatchObject({ reason: 'escrituras' });
    expect(await db.select().from(sportPerson)).toHaveLength(1);
  });
});

describe('native D1 capacity, persistence, provenance and checkpoints', () => {
  it('reproduces the pre-0021 missing publication columns offline, without executing a Neon query', () => {
    const client = vi.fn(() => { throw new Error('No Neon execution allowed'); });
    const legacy = legacyQueryBuilder(client as never);
    const built = legacy.insert(legacyPublication).values({
      source: 'skermo_ranking', season: '2025-2026', weapon: 'ESPADA', gender: 'M', category: 'M13',
      categoryRaw: 'M13', publishedOn: '2026-10-03',
    }).toSQL();
    // Drizzle lists defaults too even when the persister omits these values.
    expect(built.sql.split('values')[0]).toContain('"date_basis"');
    expect(built.sql.split('values')[0]).toContain('"revision"');
    expect(client).not.toHaveBeenCalled();
    const old = new DatabaseSync(':memory:');
    try {
      // Exact sanitized public header column inventory saved by the prior
      // SELECT-only ranking-schema-check.json (0020 schema, no 0021).
      old.exec(`create table sport_ranking_publication(
        id text,source text,season text,weapon text,gender text,category text,category_raw text,
        format text,published_on text,source_url text,published_total integer,fetched_at integer)`);
      expect(() => old.prepare('select sport_ranking_publication.date_basis from sport_ranking_publication')).toThrow('date_basis');
      expect(() => old.prepare('select sport_ranking_publication.revision from sport_ranking_publication')).toThrow('revision');
    } finally { old.close(); }
  });
  it('uses D1 storage metadata, <=8GiB allocation, tiny budgets and fail-closed unknowns', async () => {
    const { db, writer } = await owned();
    const e = { puestos: 1, asaltos: 0, documentos: 0, unidades: 1 };
    const d = await comprobarCapacidadD1(db, e);
    expect(d.umbralBytes).toBe(8589934592);
    expect(d.actualBytes).toBeGreaterThan(0);
    expect((await comprobarCapacidadD1(db, e, d.actualBytes! + 5300)).continuar).toBe(true);
    expect((await comprobarCapacidadD1(db, e, d.actualBytes! + 5296)).continuar).toBe(false);
    await expect(medirOcupacion(async () => [])).rejects.toThrow('sport_capacity_measurement_unknown');
    await expect(comprobarCapacidadD1(db, { ...e, puestos: NaN })).rejects.toThrow('sport_capacity_projection_unknown');
    expect(presupuestoD1()).toBe(D1_DEFAULT_BUDGET_BYTES);
    expect(presupuestoD1('8589934592')).toBe(8589934592);
    for (const n of ['0', '-1', 'NaN', '8589934593']) expect(() => presupuestoD1(n)).toThrow();
    vi.stubEnv('D1_STORAGE_BUDGET_BYTES', String(d.actualBytes));
    await expect(writer.insert(sportPerson).values({ displayName: 'Blocked', nameNormalized: 'blocked' })).rejects.toThrow('sport_capacity');
    expect(await db.select().from(sportPerson)).toEqual([]);
  });
  it('rejects serialized large UTF-8 payloads before dispatch rather than estimating only bind count', async () => {
    const { db, writer } = await owned();
    const d = await comprobarCapacidadD1(db, { puestos: 0, asaltos: 0, documentos: 0, unidades: 0 });
    vi.stubEnv('D1_STORAGE_BUDGET_BYTES', String(d.actualBytes! + 50_000));
    await expect(writer.insert(sportPerson).values({ displayName: 'x'.repeat(100_000), nameNormalized: 'fixture' })).rejects.toThrow();
    expect(await db.select().from(sportPerson)).toEqual([]);
    expect((await db.execute(sql`select count(*) as n from sport_write_context`)).rows[0].n).toBe(0);
    expect(reservaCapacidad([{ sql: 'insert fixture', params: ['é'.repeat(100_000)] }]))
      .toBeGreaterThan(reservaCapacidad([{ sql: 'insert fixture', params: ['a'.repeat(100_000)] }]));
  });
  it('rolls back SQL-amplified payloads and mass updates when row charges exceed the reservation', async () => {
    const { db, writer } = await owned();
    const before = (await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes;
    await expect(writer.execute(sql`insert into sport_person(display_name,name_normalized)
      values(hex(zeroblob(200000)),'amplified')`)).rejects.toThrow('sport_capacity_reservation_exhausted');
    expect(await db.select().from(sportPerson)).toEqual([]);
    expect((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes).toBe(before);
    for (let batch = 0; batch < 5; batch++) {
      await writer.insert(sportPerson).values(Array.from({ length: 10 }, (_, i) => ({
        displayName: `Fixture${batch}:${i}`, nameNormalized: `fixture${batch}:${i}`,
      })));
    }
    const charged = (await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes;
    await expect(writer.execute(sql`update sport_person set display_name='Changed'`)).rejects.toThrow('sport_capacity_reservation_exhausted');
    expect((await db.select().from(sportPerson))[0].displayName).not.toBe('Changed');
    expect((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes).toBe(charged);
    expect((await db.execute(sql`select count(*) as n from sport_write_charge`)).rows[0].n).toBe(0);
  });
  it('atomically charges concurrent batches despite stale identical storage measurements, never refunds deletes', async () => {
    const { db, writer } = await owned();
    const actual = await db.storageSize();
    vi.spyOn(db, 'storageSize').mockResolvedValue(actual);
    // One projection plus less than one committed overhead fits. A stale
    // second measurement cannot erase the first batch's actual charges.
    const firstSql = "insert into sport_person(display_name,name_normalized) values('First','first')";
    const projection = reservaCapacidad([{ sql: firstSql, params: [] }]);
    vi.stubEnv('D1_STORAGE_BUDGET_BYTES', String(actual + projection + CAPACITY_BATCH_OVERHEAD - 1));
    const writes = await Promise.allSettled([
      writer.execute(sql`insert into sport_person(display_name,name_normalized) values('First','first')`),
      writer.execute(sql`insert into sport_person(display_name,name_normalized) values('Second','second')`),
    ]);
    expect(writes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.select().from(sportPerson)).toHaveLength(1);
    vi.stubEnv('D1_STORAGE_BUDGET_BYTES', String(D1_DEFAULT_BUDGET_BYTES));
    const accounted = Number((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes);
    await writer.delete(sportPerson);
    expect(Number((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes)).toBeGreaterThan(accounted);
    await expect(db.execute(sql`update sport_capacity_ledger set accounted_bytes=0`)).rejects.toThrow();
    await expect(db.execute(sql`delete from sport_capacity_ledger`)).rejects.toThrow();
  });
  it('charges committed row work, not a per-parameter projection, and keeps no-op replay bounded', async () => {
    const { db, writer } = await owned(), id = await competition(writer);
    const actual = await db.storageSize();
    const before = Number((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes);
    const rows = Array.from({ length: 200 }, (_, i) => row(String(i + 1)));
    await escribirResultados(writer, 'fie', id, rows);
    const charged = Number((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes);
    expect(charged).toBeGreaterThan(before);
    expect(charged).toBeLessThan(actual + 4 * 1024 * 1024);
    await escribirResultados(writer, 'fie', id, rows);
    const replay = Number((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes);
    expect(replay - charged).toBeLessThan(100_000);
    expect(await db.select().from(sportResult)).toHaveLength(200);
    expect((await db.execute(sql`select count(*) as n from sport_write_context`)).rows[0].n).toBe(0);
  });
  it('updates a PDF checkpoint without charging its retained cursor again, but rejects unreserved growth', async () => {
    const { db, writer } = await owned();
    const coverage = {
      season: '2026-2027', factKind: 'pdf', competitionKey: 'doc:fixture',
      competitionId: null, status: 'parcial' as const, publishedTotal: 100, importedTotal: 0,
      sourceUrl: 'https://example.invalid/fixture.pdf', lastError: null,
    };
    const cursor = JSON.stringify({ version: 1, retained: 'é'.repeat(32_000) });
    await escribirCobertura(writer, 'rfee_pdf', { ...coverage, cursor });
    const before = Number((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes);
    await expect(escribirCobertura(writer, 'rfee_pdf', {
      ...coverage, publishedTotal: undefined, importedTotal: undefined, lastError: 'source_partial',
    })).resolves.toBeUndefined();
    const charged = Number((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes);
    expect(charged - before).toBeGreaterThan(CAPACITY_BATCH_OVERHEAD);
    expect(charged - before).toBeLessThan(CAPACITY_BATCH_OVERHEAD + 4096);
    expect((await db.execute(sql`select cursor,published_total,attempts from sport_import_coverage`)).rows[0])
      .toEqual({ cursor, published_total: 100, attempts: 2 });
    await expect(writer.execute(sql`update sport_import_coverage
      set cursor=cursor || hex(zeroblob(200000)) where competition_key='doc:fixture'`))
      .rejects.toThrow('sport_capacity_reservation_exhausted');
    expect((await db.execute(sql`select cursor from sport_import_coverage`)).rows[0].cursor).toBe(cursor);
    expect(Number((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes)).toBe(charged);
    expect((await db.execute(sql`select count(*) as n from sport_write_context`)).rows[0].n).toBe(0);
    expect((await db.execute(sql`select count(*) as n from sport_write_charge`)).rows[0].n).toBe(0);
  });
  it('fails visibly after commit and permanently blocks future owners if actual storage exceeds its reservation', async () => {
    const { db, writer, lease } = await owned();
    const actual = await db.storageSize();
    vi.spyOn(db, 'storageSize').mockResolvedValueOnce(actual).mockResolvedValue(D1_DEFAULT_BUDGET_BYTES);
    await expect(writer.insert(sportPerson).values({ displayName: 'Committed', nameNormalized: 'committed' }))
      .rejects.toThrow('sport_capacity_postcommit_unverified');
    // D1 cannot roll back a batch after it has returned metadata: never hide this.
    expect(await db.select().from(sportPerson)).toHaveLength(1);
    expect((await db.execute(sql`select blocked from sport_capacity_ledger`)).rows[0].blocked).toBe(1);
    await expect(writer.insert(sportPerson).values({ displayName: 'Blocked', nameNormalized: 'blocked' })).rejects.toThrow('sport_capacity');
    await lease.liberar();
    await expect(reclamarSportLease(db)).rejects.toThrow('sport_capacity');
    await expect(db.execute(sql`update sport_capacity_ledger set blocked=0`)).rejects.toThrow();
  });
  it('fails before writes on missing metadata; permanently blocks missing metadata after a committed batch', async () => {
    const { db, writer } = await owned();
    const actual = await db.storageSize(), probe = vi.spyOn(db, 'storageSize').mockRejectedValue(new Error('fixture'));
    await expect(writer.insert(sportPerson).values({ displayName: 'Blocked', nameNormalized: 'blocked' })).rejects.toThrow();
    expect(await db.select().from(sportPerson)).toEqual([]);
    probe.mockResolvedValueOnce(actual).mockRejectedValue(new Error('fixture'));
    await expect(writer.insert(sportPerson).values({ displayName: 'Committed', nameNormalized: 'committed' }))
      .rejects.toThrow('sport_capacity_postcommit_unverified');
    expect((await db.execute(sql`select blocked from sport_capacity_ledger`)).rows[0].blocked).toBe(1);
  });
  it('operates through a D1-shaped binding denying page PRAGMAs and virtual tables with SQLITE_AUTH 7500', async () => {
    const f = fixture();
    const deny = vi.fn((query: string) => {
      if (/\bpragma\s+page_(count|size)\b|\bpragma_page_(count|size)\s*\(/i.test(query)) {
        throw new Error('SQLITE_AUTH 7500');
      }
      return f.binding.prepare(query);
    });
    const db = createD1Database({ prepare: deny, batch: f.binding.batch });
    expect(() => db.execute(sql`pragma page_count`)).toThrow('SQLITE_AUTH 7500');
    expect(() => db.execute(sql`select * from pragma_page_count(),pragma_page_size()`)).toThrow('SQLITE_AUTH 7500');
    deny.mockClear();
    const lease = await reclamarSportLease(db), writer = dbConSportLease(db, lease!);
    expect((await comprobarCapacidadD1(db, { puestos: 1, asaltos: 0, documentos: 0, unidades: 1 })).continuar).toBe(true);
    await writer.insert(sportPerson).values({ displayName: 'Fixture', nameNormalized: 'fixture' });
    await lease!.liberar();
    expect(deny.mock.calls.every(([q]) => !/\bpragma\s+page_|\bpragma_page_/i.test(q))).toBe(true);
    for (const file of ['0002_guardia_deportiva.sql', '0005_presupuesto_8gib.sql']) {
      expect(readFileSync(new URL(`../drizzle-d1/${file}`, import.meta.url), 'utf8'))
        .not.toMatch(/\bpragma\s+page_|\bpragma_page_/i);
    }
  });
  it('repeating hundreds of results is idempotent; revisions/date mapping and D1 bounds are real', async () => {
    const { db, writer, calls, sqlite } = await owned();
    const id = await competition(writer);
    const rows = Array.from({ length: 310 }, (_, i) => row(String(i)));
    expect(await escribirResultados(writer, 'fie', id, rows)).toEqual({ nuevos: 310, revisados: 0, sinCambios: 0 });
    expect(await escribirResultados(writer, 'fie', id, rows)).toEqual({ nuevos: 0, revisados: 0, sinCambios: 310 });
    expect(await escribirResultados(writer, 'fie', id, [row('0', 2)])).toEqual({ nuevos: 0, revisados: 1, sinCambios: 0 });
    const [r] = await db.select().from(sportResult).where(eq(sportResult.sourceFactKey, '0'));
    expect(r).toMatchObject({ revision: 2, position: 2, officialPoints: '1.250', occurredOn: '2026-09-01' });
    expect(r.revisedAt).toBeInstanceOf(Date);
    expect(sqlite.prepare('select typeof(revised_at) as t from sport_result where source_fact_key=?').get('0')!.t).toBe('integer');
    expect(Math.max(...calls.map((c) => c.parameters))).toBeLessThanOrEqual(100);
  });
  it('bouts are native idempotent facts with epochms revisions and bounded inserts', async () => {
    const { db, writer } = await owned(), id = await competition(writer);
    const bout = { phase: 'TABLEAU' as const, roundKey: 'T8', fencerARef: 'a', fencerBRef: 'b',
      fencerAPersonId: null, fencerBPersonId: null, fencerAName: 'A', fencerBName: 'B',
      scoreA: 15, scoreB: 12, occurredOn: '2026-09-01', sourceUrl: 'https://fie.org/fixture', contentHash: 'first' };
    expect((await escribirAsaltos(writer, 'fie', id, [bout])).nuevos).toBe(1);
    expect((await escribirAsaltos(writer, 'fie', id, [bout])).sinCambios).toBe(1);
    expect((await escribirAsaltos(writer, 'fie', id, [{ ...bout, scoreB: 13, contentHash: 'second' }])).revisados).toBe(1);
    expect((await db.select().from(sportBout))[0]).toMatchObject({ revision: 2, scoreB: 13, revisedAt: expect.any(Date) });
  });
  it('identity batches reject overlapping IDs without orphan persons, never matching names', async () => {
    const { db, writer } = await owned(), guard = crearGuardIdentidadD1(writer);
    const c = { personId: 'first', scheme: 'fie_addr_id', value: '42', scopeSource: 'fie',
      scopeFederation: '', scopeSeason: '', scopeWeapon: '', validFrom: '2020-01-01', validTo: null,
      linkedVia: 'id_publicado', evidence: 'fixture' };
    const person = { id: 'first', displayName: 'Fixture', nameNormalized: 'fixture',
      gender: 'M' as const, countryCode: 'ESP', aliasSource: 'fie' };
    expect(await guard.confirmar(c, person)).toBe(true);
    expect(await guard.confirmar(c)).toBe(true);
    expect(await guard.confirmar({ ...c, personId: 'second' }, { ...person, id: 'second' })).toBe(false);
    expect(await db.select().from(sportPerson)).toHaveLength(1);
    expect(await db.select().from(sportExternalId)).toHaveLength(1);
    expect(await guard.conflictos({ ...c, personId: 'second' })).toHaveLength(1);
  });
  it('rankings correct one observation day atomically, preserve dates and reject empty/oversized/missing FK', async () => {
    const { db, writer } = await owned();
    const p = publication(), entries = [entry('1'), entry('2', 2)];
    const first = await escribirPublicacion(writer, p, entries);
    expect((await escribirPublicacion(writer, p, entries)).estado).toBe('sin_cambios');
    await escribirPublicacion(writer, p, [entry('1', 2)]);
    expect(await db.select().from(sportRankingEntry)).toHaveLength(1);
    const [header] = await db.select().from(sportRankingPublication);
    expect(header).toMatchObject({ id: first.publicationId, dateBasis: 'observed', revision: 2, publishedOn: p.publicadoEl });
    expect(header.fetchedAt).toBeInstanceOf(Date);
    await expect(escribirPublicacion(writer, p, [])).rejects.toThrow('sport_empty_after_published');
    await expect(escribirPublicacion(writer, p, Array.from({ length: MAX_RANKING_ENTRIES_D1 + 1 }, (_, i) => entry(String(i)))))
      .rejects.toThrow('sport_ranking_shape_invalid');
    await expect(escribirPublicacion(writer, publication('2026-10-04'), [{ ...entry('bad'), personId: 'missing' }])).rejects.toThrow();
    expect(await db.select().from(sportRankingPublication)).toHaveLength(1);
    await writer.update(sportRankingPublication).set({ dateBasis: 'published' }).where(eq(sportRankingPublication.id, first.publicationId));
    await expect(escribirPublicacion(writer, p, [entry('3')])).rejects.toThrow('sport_ranking_date_basis_conflict');
  });
  it('large atomic ranking obeys <=100 statements including context and <=100 bindings', async () => {
    const { writer, calls } = await owned();
    const entries = Array.from({ length: MAX_RANKING_ENTRIES_D1 }, (_, i) => entry(String(i)));
    await escribirPublicacion(writer, publication(), entries);
    await escribirPublicacion(writer, publication(), entries.slice(1));
    expect(Math.max(...calls.map((c) => c.parameters))).toBeLessThanOrEqual(100);
  });
  it('ranking adapters select only defined columns and historical category checks are SQLite native', async () => {
    const { writer, db } = await owned();
    const deps = crearDepsPersistenciaRankingDb(writer);
    expect(await deps.esquema()).toEqual({ identidad: true, referencias: true });
    expect(await deps.categoriasHistoricas!()).toBe(true);
    expect(await deps.licenciasRfee!('2025-2026', Array.from({ length: 130 }, (_, i) => String(i)))).toEqual(new Map());
    expect(await deps.evidencia.atletasPorLicencia(['fixture'])).toEqual([]);
    expect(await deps.evidencia.fichasFie([42], ['fixture'])).toEqual([]);
    expect(await deps.evidencia.externos(['fixture'])).toEqual([]);
    expect((await db.execute(sql`select accounted_bytes from sport_capacity_ledger`)).rows[0].accounted_bytes).toBe(0);
    expect((await db.execute(sql`select count(*) as n from sport_write_context`)).rows[0].n).toBe(0);
  });
  it('persists the historical RFEE public fixture entirely offline with observed provenance', async () => {
    const { db, writer } = await owned();
    const html = gunzipSync(readFileSync(new URL('./fixtures/historico/ranking-rfee-2021-2022-espada-m-abs.html.gz', import.meta.url))).toString();
    const reading = await leerRankingRfee({ season: { value: '12', label: '2021-2022' },
      combo: { weapon: 'ESPADA', gender: 'M', categoryValue: '7', categoryRaw: 'ABS' }, hoy: '2026-10-03' }, { html: async () => html });
    const deps = crearDepsPersistenciaRankingDb(writer);
    const result = await persistirLecturaRanking(deps, reading);
    expect(result.entradas).toBeGreaterThan(0);
    expect(result.cobertura).toBe('completo');
    expect((await persistirLecturaRanking(deps, reading)).publicacion).toBe('sin_cambios');
    expect((await persistirLecturaRanking(deps, { ...reading, publicacion: null,
      cobertura: { ...reading.cobertura, estado: 'sin_resultados', publicado: 0, importado: 0 },
    })).cobertura).toBe('conflicto');
    expect(await db.select().from(sportRankingEntry)).toHaveLength(result.entradas);
    expect(await db.select().from(sportPerson)).toEqual([]);
    expect((await db.select().from(sportRankingPublication))[0]).toMatchObject({
      season: '2021-2022', dateBasis: 'observed', publishedOn: '2026-10-03', revision: 1,
    });
  });
  it('empty-after-published coverage conflicts without losing facts/counts', async () => {
    const { db, writer } = await owned();
    const id = await competition(writer);
    await escribirResultados(writer, 'fie', id, [row()]);
    const f = { season: '2027', factKind: 'ranking', competitionKey: 'one', competitionId: id,
      status: 'completo' as const, importedTotal: 1, publishedTotal: 1, sourceUrl: null, lastError: null };
    await escribirCobertura(writer, 'fie', f);
    await escribirCobertura(writer, 'fie', { ...f, status: 'sin_resultados', importedTotal: 0, publishedTotal: 0 });
    expect((await db.execute(sql`select status,imported_total,published_total,last_error from sport_import_coverage`)).rows[0])
      .toMatchObject({ status: 'conflicto', imported_total: 1, published_total: 1, last_error: 'empty_after_published_results' });
    expect(await db.select().from(sportResult)).toHaveLength(1);
  });
  it('PDF correction never deletes an unread competition and rejects an empty exact list', async () => {
    const { db, writer } = await owned();
    const id = await competition(writer, 'rfee_pdf', 'pdf:doc:read');
    const other = await competition(writer, 'rfee_pdf', 'pdf:doc:unread');
    await escribirResultados(writer, 'rfee_pdf', id, [row('1'), row('2')]);
    await escribirResultados(writer, 'rfee_pdf', other, [row('3')]);
    const deps = crearDepsPersistenciaPdfDb(writer);
    expect(await deps.reconciliar({ season: '2027', docId: 'doc', vigentes: [{
      competitionId: id, competitionKey: 'pdf:doc:read', resultados: ['1'], asaltos: [],
    }] })).toMatchObject({ puestosRetirados: 1, pruebasRetiradas: [] });
    expect((await db.select().from(sportResult)).map((r) => r.sourceFactKey).sort()).toEqual(['1', '3']);
    await expect(deps.reconciliar({ season: '2027', docId: 'doc', vigentes: [{
      competitionId: id, competitionKey: 'pdf:doc:read', resultados: [], asaltos: [],
    }] })).rejects.toThrow('sport_empty_after_published');
    expect(await db.select().from(sportResult)).toHaveLength(2);
  });
  it('seeds current seasons, keeps checkpoints and persists monotonic cooldowns', async () => {
    const f = fixture(), d = crearDepsIncrementoDb(f.db, new PresupuestoIncremento());
    const claim = await d.claim();
    await d.seed({ fie: '2027', rfee: '2026-2027' });
    expect(await f.db.select().from(sportIncrementalTask)).toHaveLength(50);
    const t = { key: 'fie_index|2027|', season: '2027', kind: 'fie_index' as const, payload: { page: 2 } };
    await d.finish(t, { status: 'completo', facts: 0, payload: t.payload }, new Date(Date.now() + 10000));
    await d.seed({ fie: '2027', rfee: '2026-2027' });
    expect((await f.db.select().from(sportIncrementalTask).where(eq(sportIncrementalTask.key, t.key)))[0])
      .toMatchObject({ payload: { page: 2 }, attempts: 1 });
    await d.cooldown(new Date(Date.now() + 100000));
    await d.cooldown(new Date(Date.now() + 2000));
    expect(await d.due({ fie: '2027', rfee: '2026-2027' }, 2)).toEqual([]);
    await expect(comprobarCooldownD1(f.db)).rejects.toThrow('sport_source_cooldown');
    await claim!.release();
  });
});

describe('native SQLite incremental source correction with mocked HTTP only', () => {
  function fieResponses() {
    const f = JSON.parse(readFileSync(new URL('./fixtures/fie-resultados/bogota-2027-1478.json', import.meta.url), 'utf8'));
    const responses = f.respuestas;
    const metadata = responses['https://fie.org/api/fie/competition/2027/1478'];
    const one = responses['https://fie.org/api/fie/competition/2027/1478/results/ranking?page=1&pageSize=24'];
    const two = responses['https://fie.org/api/fie/competition/2027/1478/results/ranking?page=2&pageSize=24'];
    return { metadata: { ...metadata, startDate: '2020-09-01', endDate: '2020-09-02' },
      ranking: { ...one, pageSize: 200, items: [...one.items, ...two.items] } };
  }
  const task = { key: 'fie_result|2027|1478', season: '2027', kind: 'fie_result' as const, payload: { competitionId: 1478 } };
  it('retires only vanished facts in the fully-read exact competition and preserves published empties', async () => {
    const f = fixture(), response = fieResponses(), budget = new PresupuestoIncremento();
    const d = crearDepsIncrementoDb(f.db, budget), lease = await d.claim();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => Response.json(String(input).includes('/results/ranking') ? response.ranking : response.metadata));
    vi.stubGlobal('fetch', fetch);
    expect((await d.execute(task, budget)).facts).toBe(28);
    response.ranking.items = response.ranking.items.slice(0, 27);
    response.ranking.totalFound = 27;
    expect((await d.execute(task, budget)).facts).toBe(27);
    expect(await f.db.select().from(sportResult)).toHaveLength(27);
    expect((await f.db.execute(sql`select imported_total from sport_import_coverage where fact_kind='ranking'`)).rows[0].imported_total).toBe(27);
    response.ranking.items = []; response.ranking.totalFound = 0;
    expect(await d.execute(task, budget)).toEqual({ status: 'conflicto', facts: 0 });
    expect(await f.db.select().from(sportResult)).toHaveLength(27);
    expect(await f.db.select().from(sportPerson)).toEqual([]);
    expect(fetch.mock.calls.some(([url]) => /pools|tableau/.test(String(url)))).toBe(false);
    await lease!.release();
  });
  it('never writes partial/ongoing source rankings or raw errors swallowed by readers', async () => {
    const f = fixture(), response = fieResponses(), budget = new PresupuestoIncremento();
    const d = crearDepsIncrementoDb(f.db, budget), lease = await d.claim();
    response.ranking.totalFound = 700;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => Response.json(String(input).includes('/results/ranking') ? response.ranking : response.metadata)));
    expect(await d.execute(task, budget)).toEqual({ status: 'parcial', facts: 0 });
    expect(await f.db.select().from(sportResult)).toEqual([]);
    response.ranking.totalFound = 28;
    response.metadata.endDate = '2099-10-03';
    expect(await d.execute(task, budget)).toEqual({ status: 'pendiente', facts: 0 });
    expect(await f.db.select().from(sportCompetition)).toEqual([]);
    await lease!.release();
  });
});
