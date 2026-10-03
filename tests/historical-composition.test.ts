import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLICATION_TABLES, COLUMN_POLICIES, HISTORICAL_FACT_TABLES, parseSqliteSchema,
} from '@/lib/migracion-cloudflare/schema';
import { computeMigrationId, readAndValidateManifest, type MigrationManifest } from '@/lib/migracion-cloudflare/manifest';
import { composeHistoricalExport } from '@/lib/migracion-cloudflare/historical-composition';
import { importOrVerify, boundedQuery, type D1Executor } from '@/lib/migracion-cloudflare/importer';
import { sha256 } from '@/lib/migracion-cloudflare/files';

const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
const foundation = readFileSync(new URL('../drizzle-d1/0000_aplicacion.sql', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../drizzle-d1/0002_guardia_deportiva.sql', import.meta.url), 'utf8');
const schema = parseSqliteSchema(foundation);
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'calendario-history-fixture-'));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; ${foundation}`);
  cleanups.push(() => db.close());
  return db;
}
function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO club(id,name) VALUES('club','SYNTHETIC CLUB');
    INSERT INTO user_profile(id,auth_user_id,email,full_name,club_id,ical_token)
      VALUES('profile','managed-id','fixture@example.invalid','SYNTHETIC USER','club','${'a'.repeat(43)}');
    INSERT INTO sport_person(id,display_name,name_normalized) VALUES('person','SYNTHETIC ATHLETE','synthetic athlete');
    INSERT INTO sport_edition(id,source,season,tournament_key,name) VALUES('edition','fie','2026','1','SYNTHETIC EVENT');
    INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,format)
      VALUES('competition','edition','fie','2026','1','ESPADA','M','ABS','INDIVIDUAL');
    INSERT INTO sport_result(id,competition_id,source,source_fact_key,person_id,source_name,source_url,content_hash)
      VALUES('result','competition','fie','1','person','SYNTHETIC ATHLETE','https://example.invalid/fixture','hash');`);
}
async function exportFixture(db: DatabaseSync, path: string) {
  const tables = [];
  for (const name of APPLICATION_TABLES) {
    const table = schema.tables.get(name)!;
    const rows = db.prepare(`SELECT ${table.columns.map((c) => `"${c.name}"`).join(',')}
      FROM "${name}" ORDER BY ${table.primaryKey.map((c) => `"${c}"`).join(',')}`).all()
      .map((row) => Object.fromEntries(table.columns.map((c) => [c.name, row[c.name]])));
    const bytes = Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
    const file = `${name}-00000.jsonl`;
    if (rows.length) await writeFile(join(path, file), bytes, { flag: 'wx' });
    tables.push({
      name, sourcePresent: true, columns: table.columns.map((c, i) => ({
        name: c.name, sourceType: c.declaredType === 'INTEGER' ? 'integer' : 'text',
        sourceUdt: c.declaredType === 'INTEGER' ? 'int8' : 'text', nullable: !c.notNull, ordinalPosition: i + 1,
        ...(COLUMN_POLICIES[`${name}.${c.name}`] ? { policy: COLUMN_POLICIES[`${name}.${c.name}`] } : {}),
      })), rowCount: rows.length, byteCount: bytes.length, sha256: sha256(bytes),
      chunks: rows.length ? [{ file, index: 0, rowCount: rows.length, byteCount: bytes.length, sha256: sha256(bytes),
        firstKeyHash: sha256(JSON.stringify(table.primaryKey.map((key) => rows[0][key]))),
        lastKeyHash: sha256(JSON.stringify(table.primaryKey.map((key) => rows.at(-1)![key]))) }] : [],
    });
  }
  const manifest: MigrationManifest = {
    format: 'calendario-neon-d1-export', version: 1, migrationId: '', createdAt: new Date().toISOString(),
    source: { engine: 'postgresql', schema: 'public', isolation: 'repeatable read' },
    target: { engine: 'sqlite-d1', schema: 'application', schemaSha256: schema.hash },
    tables, summary: { tableCount: tables.length, rowCount: tables.reduce((n, t) => n + t.rowCount, 0),
      byteCount: tables.reduce((n, t) => n + t.byteCount, 0) },
  };
  manifest.migrationId = computeMigrationId(manifest);
  await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest));
  return readAndValidateManifest(join(path, 'manifest.json'));
}
async function fixture(options: { drift?: string; unapproved?: boolean; missingFk?: boolean; wal?: boolean } = {}) {
  const base = database(); seed(base);
  const baselineDir = await directory(), baseline = await exportFixture(base, baselineDir);
  // Copy exact baseline rows (including generated timestamps), not a newly seeded database.
  const historyDir = await directory(), historyPath = join(historyDir, 'historico.sqlite'), stage = database(historyPath);
  for (const name of APPLICATION_TABLES) {
    for (const row of base.prepare(`SELECT * FROM "${name}"`).all()) {
      const columns = schema.tables.get(name)!.columns.map((c) => c.name);
      stage.prepare(`INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(',')})
        VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((c) => row[c] as string | number | null));
    }
  }
  stage.exec(`INSERT INTO sport_result(id,competition_id,source,source_fact_key,source_name,source_url,content_hash)
    VALUES('historical-result','competition','fie','2','SYNTHETIC NEW FACT','https://example.invalid/new','new-hash');`);
  if (options.unapproved) stage.exec("UPDATE user_profile SET full_name='UNAPPROVED STAGING CHANGE'");
  if (options.missingFk) {
    stage.exec("PRAGMA foreign_keys=OFF;UPDATE sport_result SET competition_id='missing' WHERE id='historical-result';PRAGMA foreign_keys=ON");
  }
  stage.exec(guard);
  if (options.wal) stage.exec('PRAGMA journal_mode=WAL;PRAGMA wal_checkpoint(TRUNCATE)');
  // Current production profile changes must win over all staging copies.
  base.exec("UPDATE user_profile SET full_name='FRESH PROFILE',ical_token='" + 'b'.repeat(43) + "'");
  if (options.drift === 'facts') base.exec("UPDATE sport_result SET source_name='CHANGED IN PRODUCTION'");
  if (options.drift === 'identity') base.exec("UPDATE sport_person SET athlete_link_evidence='CHANGED IN PRODUCTION'");
  if (options.drift === 'external-id') base.exec("INSERT INTO sport_external_id(id,person_id,scheme,value,scope_source) VALUES('external','person','fie_addr_id','changed','fie')");
  const latestDir = await directory(), latest = await exportFixture(base, latestDir);
  const output = vi.fn(async () => directory());
  return {
    stage, baseline, latest, historyDir, historyPath, output,
    options: { workspace, baselineManifestPath: join(baselineDir, 'manifest.json'),
      latestManifestPath: join(latestDir, 'manifest.json'), historyDatabasePath: historyPath,
      expectedBaselineSha256: baseline.manifestSha256, expectedLatestSha256: latest.manifestSha256,
      expectedHistorySha256: sha256(await readFile(historyPath)) },
  };
}
describe('verified local historical composition', () => {
  it('carries accepted historical facts, preserves the fresh managed profile and passes the unchanged strict importer twice', async () => {
    const f = await fixture(), before = await readFile(f.historyPath);
    vi.stubGlobal('fetch', () => { throw new Error('NO NETWORK ALLOWED'); });
    const composed = await composeHistoricalExport(f.options, f.output);
    const { manifest } = await readAndValidateManifest(join(composed.directory, 'manifest.json'));
    expect(manifest.source.history?.tables).toEqual(HISTORICAL_FACT_TABLES);
    expect(manifest.tables.find((t) => t.name === 'user_profile')!.sha256)
      .toBe(f.latest.manifest.tables.find((t) => t.name === 'user_profile')!.sha256);
    expect(manifest.tables.find((t) => t.name === 'sport_result')!.rowCount).toBe(2);
    expect(manifest.tables.find((t) => t.name === 'sport_write_lease')!.rowCount).toBe(0);
    const destination = database(), databaseId = '11111111-1111-4111-8111-111111111111';
    const executor: D1Executor = { databaseId, async execute(query) {
      boundedQuery(query.sql, query.params);
      const stmt = destination.prepare(query.sql);
      if (stmt.columns().length) return stmt.all(...query.params);
      stmt.run(...query.params); return [];
    } };
    await importOrVerify({ workspace, schema, manifestPath: join(composed.directory, 'manifest.json'), executor,
      apply: true, expectedDatabaseId: databaseId, expectedManifestSha256: composed.manifestSha256 });
    expect((await importOrVerify({ workspace, schema, manifestPath: join(composed.directory, 'manifest.json'),
      executor, verifyOnly: true })).mode).toBe('verified');
    expect(destination.prepare('SELECT full_name,auth_user_id,ical_token FROM user_profile').get())
      .toMatchObject({ full_name: 'FRESH PROFILE', auth_user_id: 'managed-id', ical_token: 'b'.repeat(43) });
    expect(await readFile(f.historyPath)).toEqual(before);
  }, 20_000);
  it.each(['facts', 'identity', 'external-id'])('refuses fresh %s drift before creating an output', async (drift) => {
    const f = await fixture({ drift });
    await expect(composeHistoricalExport(f.options, f.output)).rejects.toThrow('history_fresh_snapshot_drift');
    expect(f.output).not.toHaveBeenCalled();
  });
  it('refuses changes to staging application data, not just new identities', async () => {
    const f = await fixture({ unapproved: true });
    await expect(composeHistoricalExport(f.options, f.output)).rejects.toThrow('history_staging_unapproved_change');
    expect(f.output).not.toHaveBeenCalled();
  });
  it('checks all three source confirmations and leaves a mismatched source unchanged', async () => {
    const f = await fixture();
    await expect(composeHistoricalExport({ ...f.options, expectedLatestSha256: 'f'.repeat(64) }, f.output))
      .rejects.toThrow('history_confirmation_required');
    await expect(composeHistoricalExport({ ...f.options, expectedHistorySha256: 'f'.repeat(64) }, f.output))
      .rejects.toThrow('history_source_hash_mismatch');
    expect(f.output).not.toHaveBeenCalled();
  });
  it('refuses a foreign-key violation in the staged facts before writing a chunk', async () => {
    const f = await fixture({ missingFk: true });
    await expect(composeHistoricalExport(f.options, f.output)).rejects.toThrow('history_source_integrity_failed');
    expect(f.output).not.toHaveBeenCalled();
  });
  it('refuses WAL sources and never removes an existing writer lock', async () => {
    const f = await fixture({ wal: true });
    await expect(composeHistoricalExport(f.options, f.output)).rejects.toThrow('history_source_writer_not_stopped');
    const lock = join(f.historyDir, '.historical-import.lock');
    await writeFile(lock, 'existing-writer');
    await expect(composeHistoricalExport(f.options, f.output)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(lock, 'utf8')).toBe('existing-writer');
    expect(f.output).not.toHaveBeenCalled();
  });
  it('validates the exact historical provenance extension without weakening target hashes or tables', async () => {
    const f = await fixture(), composed = await composeHistoricalExport(f.options, f.output);
    const path = join(composed.directory, 'manifest.json'), raw = JSON.parse(await readFile(path, 'utf8'));
    raw.source.history.tables.push('user_profile');
    await writeFile(path, JSON.stringify(raw));
    await expect(readAndValidateManifest(path)).rejects.toThrow('manifest_invalid');
  });
});
