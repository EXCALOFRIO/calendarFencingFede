import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLICATION_TABLES, COLUMN_POLICIES, parseSqliteSchema, assertApplicationSchema, quoteSqliteIdentifier,
} from '../src/lib/migracion-cloudflare/schema';
import { convertPgValue, quotePostgresIdentifier, type ExportRecord } from '../src/lib/migracion-cloudflare/codec';
import { exportSnapshot, sourceSelectExpression, type PgSnapshotClient } from '../src/lib/migracion-cloudflare/exporter';
import { importOrVerify, boundedQuery, insertBatches, buildImportPlan, type D1Executor, type MigrationQuery } from '../src/lib/migracion-cloudflare/importer';
import { readAndValidateManifest, readTargetSchema, assertPgTargetCompatibility } from '../src/lib/migracion-cloudflare/manifest';
import { remoteD1 } from '../src/lib/migracion-cloudflare/remote';
import { sanitizedError, sha256 } from '../src/lib/migracion-cloudflare/files';

const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sql = readFileSync(new URL('../drizzle-d1/0000_aplicacion.sql', import.meta.url), 'utf8');
const schema = parseSqliteSchema(sql);
const fields = JSON.parse(readFileSync(new URL('../drizzle-d1/serialization.json', import.meta.url), 'utf8')).fields as {
  table: string; column: string; postgresType: string; nullable: boolean;
}[];
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const close of cleanup.splice(0).reverse()) await close(); });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const databaseId = '11111111-1111-4111-8111-111111111111';
function sqlite(): DatabaseSync {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); db.exec(sql);
  cleanup.push(() => db.close());
  return db;
}
async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'calendario-d1-fixture-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function sourceFixture(options: { failTable?: string; unknownTable?: boolean; countMismatch?: boolean; large?: boolean } = {}) {
  const db = sqlite();
  for (let i = 1; i <= 18; i++) db.prepare('INSERT INTO club (id,name,created_at) VALUES (?,?,?)').run(uuid(i), `Synthetic '${i}'\n東京\\`, 1700000000123);
  db.prepare('INSERT INTO user_profile (id,auth_user_id,email,full_name,club_id,ical_token) VALUES (?,?,?,?,?,?)')
    .run(uuid(100), 'old-provider-id', 'fixture@example.invalid', 'Synthetic profile', uuid(1), 'NEVER-EXPORT-OLD-FEED-TOKEN');
  db.prepare('INSERT INTO club_skermo_settings (club_id,direct_submit_enabled,encrypted_password,credential_stored_at) VALUES (?,1,?,?)')
    .run(uuid(1), 'NEVER-EXPORT-PASSWORD', 1700000000123);
  db.prepare('INSERT INTO athlete (id,user_profile_id,first_name,last_name,birth_date,gender,club_id) VALUES (?,?,?,?,?,?,?)')
    .run(uuid(110), uuid(100), 'Synthetic', 'Athlete', '2010-02-03', 'M', uuid(1));
  for (const weapon of ['FLORETE', 'ESPADA', 'SABLE']) db.prepare('INSERT INTO athlete_weapon (athlete_id,weapon) VALUES (?,?)').run(uuid(110), weapon);
  for (const id of [200, 201]) db.prepare("INSERT INTO event (id,source,source_id,name,start_date,end_date,scope,content_hash,geo_lat,notes) VALUES (?,'fie',?,'Fixture','2026-10-03','2026-10-04','INTERNACIONAL','test',?,?)")
    .run(uuid(id), String(id), '12345678901234567890.12345678901234567890', options.large ? 'L'.repeat(700 * 1024) : "quote'\r\nnewline\t🙂");
  db.prepare('UPDATE event SET canonical_event_id=? WHERE id=?').run(uuid(201), uuid(200));
  db.prepare('UPDATE event SET canonical_event_id=? WHERE id=?').run(uuid(200), uuid(201));
  db.prepare("INSERT INTO sport_ranking_publication (id,source,season,weapon,gender,category,category_raw,published_on) VALUES (?,'fie','2026','ESPADA','M','ABS','SEN','2026-10-03')").run(uuid(300));
  db.prepare('INSERT INTO sport_ranking_entry (id,publication_id,source_ref,points) VALUES (?,?,?,?)').run(uuid(301), uuid(300), 'fixture', '999999999999999999.000000000001');
  db.prepare("INSERT INTO sport_person (id,display_name,name_normalized,athlete_link_evidence) VALUES (?,'Fixture','fixture',?)")
    .run(uuid(400), '{"integer":9007199254740993123456789,"quoted":"line\\nnext"}');
  const calls: { sql: string; params?: unknown[] }[] = [];
  let currentTable = '', cursorRows: Record<string, unknown>[] = [];
  const present = APPLICATION_TABLES.filter((t) => !['sport_write_lease', 'sport_incremental_task'].includes(t));
  function catalog(table: string) {
    return fields.filter((f) => f.table === table && !(table === 'sport_ranking_publication' && ['date_basis', 'revision'].includes(f.column))).map((f, i) => ({
      column_name: f.column, data_type: ['uuid', 'text', 'date', 'boolean', 'jsonb', 'integer', 'smallint', 'bigint', 'numeric'].includes(f.postgresType) || f.postgresType.startsWith('timestamp') ? f.postgresType : 'USER-DEFINED',
      udt_name: f.postgresType, is_nullable: f.nullable ? 'YES' : 'NO', ordinal_position: i + 1,
    }));
  }
  const client: PgSnapshotClient = {
    async query(query, params) {
      calls.push({ sql: query, params });
      if (/^(BEGIN|ROLLBACK|SET|CLOSE)/.test(query)) return { rows: [] };
      if (query.includes("current_setting('transaction_read_only')")) return { rows: [{ ro: 'on', isolation: 'repeatable read' }] };
      if (query.includes('information_schema.tables')) return { rows: [...present, ...(options.unknownTable ? ['private_unknown'] : [])].map((table_name) => ({ table_name })) };
      if (query.includes('information_schema.columns')) return { rows: catalog(String(params![0])) };
      if (query.includes('pg_total_relation_size')) return { rows: [{ bytes: '100000' }] };
      if (query.startsWith('SELECT count')) {
        const table = query.match(/public\."([^"]+)"/)![1]!;
        const n = Number(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get()!.n);
        return { rows: [{ count: String(n + (options.countMismatch && table === 'club' ? 1 : 0)) }] };
      }
      if (query.startsWith('DECLARE')) {
        currentTable = query.match(/FROM public\."([^"]+)"/)![1]!;
        if (options.failTable === currentTable) throw { code: 'XX000', message: 'PRIVATE SOURCE RECORD' };
        const table = schema.tables.get(currentTable)!;
        const rows = db.prepare(`SELECT * FROM "${currentTable}" ORDER BY ${table.primaryKey.map((c) => `"${c}"`).join(',')}`).all();
        cursorRows = rows.map((row) => Object.fromEntries(catalog(currentTable).map((c) => {
          let value: unknown = row[c.column_name];
          if (COLUMN_POLICIES[`${currentTable}.${c.column_name}`]) value = null;
          else if (value !== null && c.data_type === 'boolean') value = value === 1 ? 'true' : 'false';
          else if (value !== null && c.data_type.startsWith('timestamp')) value = new Date(Number(value)).toISOString();
          else if (value !== null) value = String(value);
          return [c.column_name, value];
        })));
        return { rows: [] };
      }
      if (query.startsWith('FETCH')) { const rows = cursorRows; cursorRows = []; return { rows }; }
      throw new Error('fixture_query_unexpected');
    },
  };
  return { client, db, calls };
}
function destinationFixture(db = sqlite()) {
  const calls: MigrationQuery[] = [];
  let failAfterInsert = false;
  const executor: D1Executor = {
    databaseId,
    async execute(query) {
      boundedQuery(query.sql, query.params); calls.push(query);
      if (failAfterInsert && query.sql.startsWith('INSERT INTO "event"')) {
        failAfterInsert = false;
        db.prepare(query.sql).run(...query.params);
        throw new Error('d1_network_failure');
      }
      const statement = db.prepare(query.sql);
      if (statement.columns().length) return statement.all(...query.params) as Record<string, unknown>[];
      statement.run(...query.params); return [];
    },
  };
  return { executor, db, calls, failOnce: () => { failAfterInsert = true; } };
}
async function exported(options: Parameters<typeof sourceFixture>[0] = {}) {
  const source = sourceFixture(options), dir = await directory();
  const manifest = await exportSnapshot(source.client, schema, dir);
  const manifestPath = join(dir, 'manifest.json');
  const validated = await readAndValidateManifest(manifestPath);
  return { ...source, dir, manifest, manifestPath, manifestSha256: validated.manifestSha256 };
}

describe('migration conversion and schema contracts', () => {
  it('pins the entire exact 54-table / 681-column schema and rejects identifier injection', async () => {
    assertApplicationSchema(schema);
    expect(schema.tables.size).toBe(54);
    expect([...schema.tables.values()].reduce((n, t) => n + t.columns.length, 0)).toBe(681);
    expect((await readTargetSchema(workspace)).schema.hash).toBe(schema.hash);
    expect(parseSqliteSchema(sql + '\n').hash).not.toBe(schema.hash);
    expect(() => quotePostgresIdentifier('club";DELETE')).toThrow('identifier_not_allowlisted');
    expect(() => quoteSqliteIdentifier('neon_auth.user')).toThrow('identifier_not_allowlisted');
    const plan = buildImportPlan(schema);
    expect(plan.deferred.get('event')).toContain('canonical_event_id');
    expect(plan.deferred.get('sport_person')).toContain('merged_into_person_id');
    for (const name of plan.order) for (const fk of schema.tables.get(name)!.foreignKeys) {
      if (!plan.deferred.get(name)!.has(fk.columns[0]!)) expect(plan.order.indexOf(fk.table)).toBeLessThan(plan.order.indexOf(name));
    }
  });
  it('preserves dates, UTC milliseconds, JSON big integers, arrays, decimals, booleans and null', () => {
    const target = { name: 'fixture', declaredType: 'TEXT', primaryKeyPosition: 0, notNull: false };
    const convert = (value: unknown, dataType: string, udtName = dataType, integer = false) => convertPgValue(value, {
      name: 'fixture', dataType, udtName, nullable: true, ordinalPosition: 1,
    }, { ...target, declaredType: integer ? 'INTEGER' : 'TEXT' });
    expect(convert('2026-10-03', 'date')).toBe('2026-10-03');
    expect(convert('2026-10-03 12:13:14.123456+00', 'timestamp with time zone', 'timestamptz', true)).toBe(Date.parse('2026-10-03T12:13:14.123Z'));
    expect(convert('2026-10-03 14:13:14.123+02:00', 'timestamp with time zone', 'timestamptz', true)).toBe(Date.parse('2026-10-03T12:13:14.123Z'));
    expect(convert('2026-10-03 12:13:14.123', 'timestamp without time zone', 'timestamp', true)).toBe(Date.parse('2026-10-03T12:13:14.123Z'));
    const json = '{"integer":9007199254740993123456789,"newline":"a\\nb"}';
    expect(convert(json, 'jsonb')).toBe(json);
    expect(convert('["quote\'","line\\nnext",null]', 'ARRAY', '_text')).toBe('["quote\'","line\\nnext",null]');
    expect(convert('123456789012345678901234567890.00000000000001', 'numeric')).toBe('123456789012345678901234567890.00000000000001');
    expect(convert('false', 'boolean', 'bool', true)).toBe(0);
    expect(convert('true', 'boolean', 'bool', true)).toBe(1);
    expect(convert(null, 'text')).toBeNull();
    expect(() => convert(undefined, 'text')).toThrow('source_value_missing');
    expect(() => convert('2026-02-30', 'date')).toThrow('date_invalid');
    expect(() => convert('9007199254740993', 'bigint', 'int8', true)).toThrow('integer_not_safe');
    expect(() => convert('12.5', 'numeric', 'numeric', true)).toThrow('decimal_target_not_text');
    assertPgTargetCompatibility('fixture', [
      { name: 'date', sourceType: 'date', sourceUdt: 'date', nullable: false, ordinalPosition: 1 },
      { name: 'time', sourceType: 'timestamp with time zone', sourceUdt: 'timestamptz', nullable: false, ordinalPosition: 2 },
    ], [{ name: 'date', declaredType: 'TEXT' }, { name: 'time', declaredType: 'INTEGER' }]);
  });
  it('rejects all statement/parameter/payload overflow before execution', () => {
    expect(() => boundedQuery('SELECT ?', Array(101).fill(1))).toThrow('d1_parameter_limit');
    expect(() => boundedQuery('S'.repeat(100 * 1024 + 1))).toThrow('d1_statement_limit');
    expect(() => boundedQuery('SELECT ?', ['x'.repeat(900 * 1024)])).toThrow('d1_payload_limit');
    const table = schema.tables.get('club')!;
    const db = sqlite(); db.prepare('INSERT INTO club (id,name) VALUES (?,?)').run(uuid(1), 'fixture');
    const row = db.prepare('SELECT * FROM club').get()! as ExportRecord;
    const batches = insertBatches(table, Array.from({ length: 40 }, (_, i) => ({ ...row, id: uuid(i + 1) })));
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((q) => q.params.length <= 100 && Buffer.byteLength(JSON.stringify(q)) <= 900 * 1024)).toBe(true);
  });
});
describe('read-only export and bounded idempotent import', () => {
  it('exports one snapshot with sanitized manifest and never SELECTs legacy credentials', async () => {
    const fixture = await exported();
    expect(fixture.calls[0]!.sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(fixture.calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(fixture.calls.every((c) => !/\b(INSERT|UPDATE|DELETE|COMMIT|DROP|TRUNCATE)\b/.test(c.sql))).toBe(true);
    const text = await readFile(fixture.manifestPath, 'utf8');
    expect(text).not.toContain('fixture@example.invalid');
    expect(text).not.toContain('NEVER-EXPORT');
    expect(fixture.manifest.tables.find((t) => t.name === 'sport_incremental_task')!.sourcePresent).toBe(false);
    const profiles = await readFile(join(fixture.dir, 'user_profile-00000.jsonl'), 'utf8');
    expect(profiles).not.toContain('NEVER-EXPORT');
    const record = JSON.parse(profiles.trim());
    expect(record.auth_user_id).toBe('old-provider-id'); expect(record.ical_token).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    const settings = JSON.parse((await readFile(join(fixture.dir, 'club_skermo_settings-00000.jsonl'), 'utf8')).trim());
    expect(settings.encrypted_password).toBeNull(); expect(settings.credential_stored_at).toBeNull(); expect(settings.direct_submit_enabled).toBe(0);
    const publications = JSON.parse((await readFile(join(fixture.dir, 'sport_ranking_publication-00000.jsonl'), 'utf8')).trim());
    expect(publications.date_basis).toBe('observed'); expect(publications.revision).toBe(1);
    for (const c of fixture.manifest.tables.find((t) => t.name === 'user_profile')!.columns.filter((c) => c.policy)) {
      expect(sourceSelectExpression('user_profile', c)).toBe(`NULL::text AS "${c.name}"`);
    }
    expect(await importOrVerify({ manifestPath: fixture.manifestPath, schema, workspace })).toMatchObject({ mode: 'local-preflight', rows: fixture.manifest.summary.rowCount });
  });
  it('rolls back source failures and count drift without publishing a valid manifest', async () => {
    for (const opts of [{ failTable: 'event' }, { countMismatch: true }, { unknownTable: true }]) {
      const fixture = sourceFixture(opts), dir = await directory();
      await expect(exportSnapshot(fixture.client, schema, dir)).rejects.toBeDefined();
      expect(fixture.calls.at(-1)!.sql).toBe('ROLLBACK');
      await expect(readFile(join(dir, 'manifest.json'))).rejects.toBeDefined();
    }
    expect(sanitizedError({ code: 'XX000', message: 'PRIVATE' })).toBe('source_sqlstate_XX000');
    expect(sanitizedError(new Error('PRIVATE SOURCE RECORD'))).toBe('migration_operation_failed');
  });
  it('defaults to read-only and requires exact database AND manifest confirmations to write', async () => {
    const fixture = await exported(), target = destinationFixture();
    const options = { manifestPath: fixture.manifestPath, schema, workspace, executor: target.executor };
    expect(await importOrVerify(options)).toMatchObject({ mode: 'destination-preflight', existingRows: 0 });
    expect(target.calls.every((q) => /^(SELECT|PRAGMA)/.test(q.sql))).toBe(true);
    await expect(importOrVerify({ ...options, apply: true, expectedDatabaseId: 'wrong' })).rejects.toThrow('destination_database_confirmation_required');
    await expect(importOrVerify({ ...options, apply: true, expectedDatabaseId: databaseId, expectedManifestSha256: 'wrong' })).rejects.toThrow('manifest_hash_confirmation_required');
    expect(target.db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='cloudflare_data_migration'").get()!.n).toBe(0);
  });
  it('imports and verifies exact counts/hashes/constraints, cyclic self-FKs, JSON/decimal/large rows and reruns without duplicates', async () => {
    const fixture = await exported({ large: true }), target = destinationFixture();
    const options = {
      manifestPath: fixture.manifestPath, schema, workspace, executor: target.executor, apply: true,
      expectedDatabaseId: databaseId, expectedManifestSha256: fixture.manifestSha256,
    };
    expect(await importOrVerify(options)).toMatchObject({ mode: 'verified', rows: fixture.manifest.summary.rowCount });
    expect(target.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(target.db.prepare('SELECT canonical_event_id FROM event WHERE id=?').get(uuid(200))!.canonical_event_id).toBe(uuid(201));
    expect(target.db.prepare('SELECT geo_lat FROM event WHERE id=?').get(uuid(200))!.geo_lat).toBe('12345678901234567890.12345678901234567890');
    expect(target.db.prepare('SELECT athlete_link_evidence FROM sport_person').get()!.athlete_link_evidence).toContain('9007199254740993123456789');
    expect(target.db.prepare('SELECT status FROM cloudflare_data_migration').get()!.status).toBe('complete');
    expect(target.calls.every((q) => q.params.length <= 100 && Buffer.byteLength(JSON.stringify(q)) <= 900 * 1024)).toBe(true);
    const before = target.db.prepare('SELECT count(*) AS n FROM event').get()!.n;
    await importOrVerify(options);
    expect(target.db.prepare('SELECT count(*) AS n FROM event').get()!.n).toBe(before);
    expect(await importOrVerify({ ...options, apply: false, verifyOnly: true })).toMatchObject({ mode: 'verified' });
  });
  it('resumes ambiguous accepted writes only with matching migration and exact row hashes', async () => {
    const fixture = await exported(), target = destinationFixture();
    const options = {
      manifestPath: fixture.manifestPath, schema, workspace, executor: target.executor, apply: true,
      expectedDatabaseId: databaseId, expectedManifestSha256: fixture.manifestSha256,
    };
    target.failOnce();
    await expect(importOrVerify(options)).rejects.toThrow('d1_network_failure');
    expect(target.db.prepare('SELECT status FROM cloudflare_data_migration').get()!.status).toBe('importing');
    expect(target.db.prepare('SELECT checkpoint FROM cloudflare_data_migration').get()!.checkpoint).not.toContain('insert:event:');
    expect(await importOrVerify(options)).toMatchObject({ mode: 'verified' });
    target.db.prepare("UPDATE club SET name='unexpected alteration' WHERE id=?").run(uuid(1));
    const start = target.calls.length;
    await expect(importOrVerify(options)).rejects.toThrow('destination_row_hash_mismatch');
    expect(target.calls.slice(start).every((q) => /^(SELECT|PRAGMA)/.test(q.sql))).toBe(true);
  });
  it('rejects corruption, unsafe chunk paths and oversized rows before any destination writes', async () => {
    const fixture = await exported(), target = destinationFixture();
    const chunkPath = join(fixture.dir, 'club-00000.jsonl');
    await writeFile(chunkPath, (await readFile(chunkPath, 'utf8')).replace('Synthetic', 'Corrupted'));
    await expect(importOrVerify({ manifestPath: fixture.manifestPath, schema, workspace, executor: target.executor, apply: true })).rejects.toThrow('export_chunk');
    expect(target.calls).toHaveLength(0);
    const other = await exported();
    const altered = JSON.parse(await readFile(other.manifestPath, 'utf8'));
    altered.tables[0].chunks[0].file = '../outside.jsonl';
    await writeFile(other.manifestPath, JSON.stringify(altered));
    await expect(readAndValidateManifest(other.manifestPath)).rejects.toThrow('manifest_chunk_path_invalid');
    const source = sourceFixture(); const dir = await directory();
    source.db.prepare('UPDATE event SET notes=?').run('x'.repeat(881 * 1024));
    await expect(exportSnapshot(source.client, schema, dir)).rejects.toThrow('export_row_exceeds_d1_payload');
    await expect(readFile(join(dir, 'manifest.json'))).rejects.toBeDefined();
  });
  it('refuses nonempty/unrelated destinations and post-import sport fence schemas without changing them', async () => {
    const fixture = await exported(), target = destinationFixture();
    const options = { manifestPath: fixture.manifestPath, schema, workspace, executor: target.executor, apply: true, expectedDatabaseId: databaseId, expectedManifestSha256: fixture.manifestSha256 };
    // Matching data without a ledger still cannot authorize adopting a nonempty database.
    const club = JSON.parse((await readFile(join(fixture.dir, 'club-00000.jsonl'), 'utf8')).split('\n')[0]!);
    target.db.prepare(insertBatches(schema.tables.get('club')!, [club])[0]!.sql).run(...insertBatches(schema.tables.get('club')!, [club])[0]!.params);
    await expect(importOrVerify(options)).rejects.toThrow('destination_not_empty');
    const unrelated = destinationFixture(); unrelated.db.exec('CREATE TABLE unrelated (id TEXT)');
    await expect(importOrVerify({ ...options, executor: unrelated.executor })).rejects.toThrow('destination_unrelated_schema');
    const fenced = destinationFixture();
    fenced.db.exec(readFileSync(new URL('../drizzle-d1/0002_guardia_deportiva.sql', import.meta.url), 'utf8'));
    await expect(importOrVerify({ ...options, executor: fenced.executor })).rejects.toThrow('destination_application_schema_mismatch');
  });
  it('never marks complete if final constraints fail, and refuses a different manifest on resume', async () => {
    const fixture = await exported(), target = destinationFixture();
    const executor: D1Executor = {
      databaseId,
      async execute(query) {
        if (query.sql === 'PRAGMA foreign_key_check') return [{ table: 'synthetic', rowid: 1, parent: 'synthetic', fkid: 0 }];
        return target.executor.execute(query);
      },
    };
    const options = {
      manifestPath: fixture.manifestPath, schema, workspace, executor, apply: true,
      expectedDatabaseId: databaseId, expectedManifestSha256: fixture.manifestSha256,
    };
    await expect(importOrVerify(options)).rejects.toThrow('destination_foreign_key_violation');
    expect(target.db.prepare('SELECT status FROM cloudflare_data_migration').get()!.status).toBe('importing');
    const changed = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
    changed.createdAt = '2026-10-04T00:00:00.000Z';
    await writeFile(fixture.manifestPath, `${JSON.stringify(changed, null, 2)}\n`);
    await expect(importOrVerify({ ...options, executor: target.executor })).rejects.toThrow('destination_migration_mismatch');
  });
  it('fails closed on a source transaction that is not read-only', async () => {
    const fixture = sourceFixture(), dir = await directory();
    const client: PgSnapshotClient = {
      query: async (query, params) => query.includes("current_setting('transaction_read_only')")
        ? { rows: [{ ro: 'off', isolation: 'repeatable read' }] }
        : fixture.client.query(query, params),
    };
    await expect(exportSnapshot(client, schema, dir)).rejects.toThrow('source_snapshot_not_readonly');
    expect(fixture.calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(fixture.calls.some((c) => c.sql.includes('information_schema.tables'))).toBe(false);
  });
});
describe('remote protocol safety (offline fetch fixtures)', () => {
  it('blocks writes by default and never retries non-idempotent DDL or leaks API bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('PRIVATE ERROR BODY', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const readonly = remoteD1('a'.repeat(32), databaseId, 'synthetic-token');
    await expect(readonly.execute(boundedQuery('CREATE TABLE forbidden (id TEXT)'))).rejects.toThrow('remote_readonly_operation_required');
    expect(fetchMock).not.toHaveBeenCalled();
    const writable = remoteD1('a'.repeat(32), databaseId, 'synthetic-token', true);
    await expect(writable.execute(boundedQuery('CREATE TABLE fixture (id TEXT)'))).rejects.toThrow('d1_http_503');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('accepts the documented single-query result envelope and retries only safe exact inserts', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('ambiguous connection loss PRIVATE'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [{ success: true, results: [] }] })));
    vi.stubGlobal('fetch', fetchMock);
    const writable = remoteD1('a'.repeat(32), databaseId, 'synthetic-token', true);
    await expect(writable.execute(boundedQuery('INSERT INTO "club" ("id") VALUES (?) ON CONFLICT ("id") DO NOTHING', [uuid(1)]))).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sha256('test')).toHaveLength(64);
  });
});
