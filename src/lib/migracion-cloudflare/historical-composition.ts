/** Local, read-only composition. Never opens Neon, a remote binding or a writable SQLite database. */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { lstat, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import {
  APPLICATION_TABLES, HISTORICAL_FACT_TABLES, quoteSqliteIdentifier as q,
  type SqliteTable,
} from './schema';
import { assertRecordMatchesTable, rowHashUpdate, type ExportRecord } from './codec';
import {
  computeMigrationId, readAndValidateManifest, readTargetSchema,
  type ManifestTable, type MigrationManifest,
} from './manifest';
import { assertCapacity, compareKeys, createPrivateExportDirectory, keyOf, readExportRows, sha256 } from './files';
import { importOrVerify, insertBatches, buildImportPlan } from './importer';
import { abrirD1Local } from '../ingest/sport-incremental/local';
import { verificarEsquemaD1 } from '../ingest/sport-incremental/schema';

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_ROW_BYTES = 880 * 1024;
export const COMPOSITION_LIMITS = {
  sourceBytes: 4 * 1024 ** 3, outputBytes: 1024 ** 3, rows: 1_500_000,
} as const;
const historical = new Set<string>(HISTORICAL_FACT_TABLES);
// Copied facts retain these IDs and source-to-person mappings. Any drift
// requires replay/review against the fresh snapshot, never a blind UUID merge.
const freshGuards = new Set<string>([
  ...HISTORICAL_FACT_TABLES, 'sport_person', 'sport_external_id', 'event', 'event_competition',
]);
type Summary = Pick<ManifestTable, 'rowCount' | 'byteCount' | 'sha256'>;
export type HistoricalCompositionOptions = {
  workspace: string;
  baselineManifestPath: string;
  latestManifestPath: string;
  historyDatabasePath: string;
  expectedBaselineSha256: string;
  expectedLatestSha256: string;
  expectedHistorySha256: string;
};

async function digestDatabase(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('history_absolute_source_required');
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 ||
    before.size > COMPOSITION_LIMITS.sourceBytes) throw new Error('history_source_file_invalid');
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error('history_source_file_changed');
    }
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (!bytesRead) throw new Error('history_source_file_changed');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('history_source_file_changed');
    return hash.digest('hex');
  } finally { await handle.close(); }
}

function* sourceRows(sqlite: DatabaseSync, table: SqliteTable): Generator<ExportRecord> {
  const selected = table.columns.map((column) => q(column.name)).join(',');
  const order = table.primaryKey.map(q).join(',');
  let previous: ReturnType<typeof keyOf> | undefined;
  for (const item of sqlite.prepare(`SELECT ${selected} FROM ${q(table.name)} ORDER BY ${order}`).iterate()) {
    const record = Object.fromEntries(table.columns.map((column) => [column.name, item[column.name]])) as ExportRecord;
    assertRecordMatchesTable(record, table);
    const key = keyOf(record, table);
    if (previous && compareKeys(previous, key) >= 0) throw new Error('history_source_keys_not_ordered');
    previous = key;
    yield record;
  }
}
function summarize(rows: Iterable<ExportRecord>): Summary {
  const hash = createHash('sha256');
  let rowCount = 0, byteCount = 0;
  for (const row of rows) {
    byteCount += rowHashUpdate(hash, row).length; rowCount++;
    if (rowCount > COMPOSITION_LIMITS.rows || byteCount > COMPOSITION_LIMITS.outputBytes) {
      throw new Error('history_composition_limit');
    }
  }
  return { rowCount, byteCount, sha256: hash.digest('hex') };
}
const equal = (a: Summary, b: Summary) =>
  a.rowCount === b.rowCount && a.byteCount === b.byteCount && a.sha256 === b.sha256;

async function writeTable(
  directory: string, metadata: ManifestTable, table: SqliteTable,
  rows: AsyncIterable<ExportRecord> | Iterable<ExportRecord>, expected: Summary,
  deferred: Set<string>,
): Promise<ManifestTable> {
  const entry: ManifestTable = { ...metadata, chunks: [], rowCount: 0, byteCount: 0, sha256: '' };
  const hash = createHash('sha256');
  let buffers: Buffer[] = [], bytes = 0, first: string | null = null, last: string | null = null;
  const flush = async () => {
    if (!buffers.length) return;
    const contents = Buffer.concat(buffers, bytes);
    const file = `${table.name}-${String(entry.chunks.length).padStart(5, '0')}.jsonl`;
    await assertCapacity(directory, CHUNK_BYTES * 3);
    await writeFile(join(directory, file), contents, { flag: 'wx', mode: 0o600 });
    entry.chunks.push({ file, index: entry.chunks.length, rowCount: buffers.length, byteCount: bytes,
      sha256: sha256(contents), firstKeyHash: first, lastKeyHash: last });
    buffers = []; bytes = 0; first = null; last = null;
  };
  for await (const row of rows) {
    // Check the strict import's bind/payload limits before emitting any row.
    const staged = Object.fromEntries(Object.entries(row).map(([column, value]) =>
      [column, deferred.has(column) ? null : value]));
    insertBatches(table, [staged]);
    const buffer = rowHashUpdate(hash, row);
    if (buffer.length > MAX_ROW_BYTES) throw new Error('export_row_exceeds_d1_payload');
    if (bytes + buffer.length > CHUNK_BYTES) await flush();
    buffers.push(buffer); bytes += buffer.length;
    entry.rowCount++; entry.byteCount += buffer.length;
    last = sha256(JSON.stringify(keyOf(row, table))); first ??= last;
  }
  await flush(); entry.sha256 = hash.digest('hex');
  if (!equal(entry, expected)) throw new Error('history_composition_source_changed');
  return entry;
}

export async function composeHistoricalExport(
  options: HistoricalCompositionOptions,
  createDirectory: (workspace: string) => Promise<string> = createPrivateExportDirectory,
) {
  const { schema } = await readTargetSchema(options.workspace);
  const baseline = await readAndValidateManifest(options.baselineManifestPath);
  const latest = await readAndValidateManifest(options.latestManifestPath);
  if (baseline.manifestSha256 !== options.expectedBaselineSha256 ||
    latest.manifestSha256 !== options.expectedLatestSha256 ||
    !/^[a-f0-9]{64}$/.test(options.expectedHistorySha256)) throw new Error('history_confirmation_required');
  if (baseline.manifest.source.engine !== 'postgresql' || latest.manifest.source.engine !== 'postgresql' ||
    baseline.manifest.target.schemaSha256 !== schema.hash || latest.manifest.target.schemaSha256 !== schema.hash) {
    throw new Error('history_base_schema_mismatch');
  }
  await importOrVerify({ workspace: options.workspace, schema, manifestPath: options.baselineManifestPath });
  await importOrVerify({ workspace: options.workspace, schema, manifestPath: options.latestManifestPath });
  const original = new Map(baseline.manifest.tables.map((entry) => [entry.name, entry]));
  for (const entry of latest.manifest.tables) {
    if (freshGuards.has(entry.name) && !equal(entry, original.get(entry.name)!)) {
      throw new Error('history_fresh_snapshot_drift');
    }
  }
  // Same lock as the historical writer, exclusive and never removed unless
  // this invocation owns it. An existing lock is evidence, not stale cleanup.
  const lockPath = join(dirname(options.historyDatabasePath), '.historical-import.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  let sqlite: DatabaseSync | undefined;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, kind: 'historical-composition' }));
    if (await digestDatabase(options.historyDatabasePath) !== options.expectedHistorySha256) {
      throw new Error('history_source_hash_mismatch');
    }
    const local = abrirD1Local(options.historyDatabasePath, false);
    try { await verificarEsquemaD1(local.db); } finally { local.close(); }
    sqlite = new DatabaseSync(options.historyDatabasePath, { readOnly: true });
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA query_only=ON; BEGIN;');
    if (sqlite.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'delete' ||
      Number(sqlite.prepare("SELECT count(*) AS n FROM sport_write_lease WHERE expires_at>cast(strftime('%s','now') AS integer)*1000").get()!.n)) {
      throw new Error('history_source_writer_not_stopped');
    }
    if (sqlite.prepare('PRAGMA foreign_key_check').all().length ||
      sqlite.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new Error('history_source_integrity_failed');
    const summaries = new Map<string, Summary>();
    let outputBytes = 0, outputRows = 0;
    for (const name of APPLICATION_TABLES) {
      // Owner/version lease state is operational. The fresh snapshot's
      // lease is retained; staging never supplies it to the new database.
      if (name === 'sport_write_lease') continue;
      const summary = summarize(sourceRows(sqlite, schema.tables.get(name)!));
      if (!historical.has(name) && !equal(summary, original.get(name)!)) {
        throw new Error('history_staging_unapproved_change');
      }
      summaries.set(name, summary);
    }
    for (const entry of latest.manifest.tables) {
      const summary = historical.has(entry.name) ? summaries.get(entry.name)! : entry;
      outputBytes += summary.byteCount; outputRows += summary.rowCount;
    }
    if (outputBytes > COMPOSITION_LIMITS.outputBytes || outputRows > COMPOSITION_LIMITS.rows) {
      throw new Error('history_composition_limit');
    }
    const directory = await createDirectory(options.workspace);
    await assertCapacity(directory, outputBytes * 3);
    const plan = buildImportPlan(schema), tables: ManifestTable[] = [];
    for (const metadata of latest.manifest.tables) {
      const table = schema.tables.get(metadata.name)!;
      const rows = historical.has(metadata.name) ? sourceRows(sqlite, table)
        : readExportRows(latest.directory, metadata, table);
      tables.push(await writeTable(directory, metadata, table, rows,
        historical.has(metadata.name) ? summaries.get(metadata.name)! : metadata, plan.deferred.get(metadata.name)!));
    }
    if (await digestDatabase(options.historyDatabasePath) !== options.expectedHistorySha256) {
      throw new Error('history_source_hash_mismatch');
    }
    const manifest: MigrationManifest = {
      ...latest.manifest, migrationId: '', createdAt: new Date().toISOString(), tables,
      source: { engine: 'postgresql+verified-history', schema: 'public', isolation: 'repeatable read',
        history: { baselineManifestSha256: baseline.manifestSha256,
          latestManifestSha256: latest.manifestSha256, sqliteSha256: options.expectedHistorySha256,
          tables: HISTORICAL_FACT_TABLES } },
      summary: { tableCount: tables.length, rowCount: outputRows, byteCount: outputBytes },
    };
    manifest.migrationId = computeMigrationId(manifest);
    await writeFile(join(directory, 'manifest.pending'), `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 });
    await rename(join(directory, 'manifest.pending'), join(directory, 'manifest.json'));
    await importOrVerify({ workspace: options.workspace, schema, manifestPath: join(directory, 'manifest.json') });
    return { directory, migrationId: manifest.migrationId,
      manifestSha256: sha256(await readFile(join(directory, 'manifest.json'))),
      ...manifest.summary, historicalTables: HISTORICAL_FACT_TABLES, remoteAccess: false };
  } finally {
    if (sqlite) { try { sqlite.exec('ROLLBACK'); } finally { sqlite.close(); } }
    await lock.close();
    // The exclusive file is this invocation's, never someone else's lock.
    const { unlink } = await import('node:fs/promises');
    await unlink(lockPath);
  }
}
