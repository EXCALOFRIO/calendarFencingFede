import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertRecordMatchesTable, type ExportRecord, rowHashUpdate } from './codec';
import {
  MAX_BIND_PARAMETERS, MAX_STATEMENT_BYTES, MAX_QUERY_PAYLOAD_BYTES,
  readAndValidateManifest, manifestHasOnlyExpectedColumns, assertPgTargetCompatibility,
  type MigrationManifest, type ManifestTable,
} from './manifest';
import {
  APPLICATION_TABLES, TABLE_IMPORT_ORDER, COLUMN_POLICIES,
  quoteSqliteIdentifier as q, type SqliteSchema, type SqliteTable,
} from './schema';
import { readExportRows, keyOf, compareKeys, sha256 } from './files';

export type Scalar = string | number | null;
export interface MigrationQuery { sql: string; params: Scalar[] }
/** Each execute is a bounded single D1 query; no assumed REST batch atomicity. */
export interface D1Executor {
  databaseId: string;
  execute(query: MigrationQuery): Promise<Record<string, unknown>[]>;
  /** Sólo transportes que ofrecen realmente el batch atómico de D1. */
  executeBatch?(queries: MigrationQuery[]): Promise<Record<string, unknown>[][]>;
}
export function boundedQuery(sql: string, params: Scalar[] = []): MigrationQuery {
  if (params.length > MAX_BIND_PARAMETERS) throw new Error('d1_parameter_limit');
  if (Buffer.byteLength(sql) > MAX_STATEMENT_BYTES) throw new Error('d1_statement_limit');
  if (Buffer.byteLength(JSON.stringify({ sql, params })) > MAX_QUERY_PAYLOAD_BYTES) throw new Error('d1_payload_limit');
  return { sql, params };
}
export function insertBatches(table: SqliteTable, rows: ExportRecord[]): MigrationQuery[] {
  const queries: MigrationQuery[] = [];
  const prefix = `INSERT INTO ${q(table.name)} (${table.columns.map((c) => q(c.name)).join(',')}) VALUES `;
  const tuple = `(${table.columns.map(() => '?').join(',')})`;
  const suffix = ` ON CONFLICT (${table.primaryKey.map(q).join(',')}) DO NOTHING`;
  let batch: ExportRecord[] = [];
  function query(records: ExportRecord[]) {
    return boundedQuery(prefix + records.map(() => tuple).join(',') + suffix, records.flatMap((row) => table.columns.map((c) => row[c.name]!)));
  }
  for (const row of rows) {
    assertRecordMatchesTable(row, table);
    const candidate = [...batch, row];
    try { query(candidate); batch = candidate; }
    catch (error) {
      if (!batch.length) throw error;
      queries.push(query(batch)); batch = [row]; query(batch);
    }
  }
  if (batch.length) queries.push(query(batch));
  return queries;
}
export interface ImportPlan { order: string[]; deferred: Map<string, Set<string>> }
export function buildImportPlan(schema: SqliteSchema): ImportPlan {
  const order: string[] = [];
  const remaining = new Set<string>(TABLE_IMPORT_ORDER);
  // Non-null references cannot be staged. Order those first; nullable references
  // to a later table or to the same table are restored in a second pass.
  while (remaining.size) {
    const next = [...remaining].find((name) => schema.tables.get(name)!.foreignKeys.every((fk) =>
      fk.columns.every((c) => !schema.tables.get(name)!.columns.find((column) => column.name === c)!.notNull) ||
      !remaining.has(fk.table),
    ));
    if (!next) throw new Error('nonnullable_foreign_key_cycle');
    order.push(next); remaining.delete(next);
  }
  const deferred = new Map<string, Set<string>>();
  for (const [index, name] of order.entries()) {
    const columns = new Set<string>();
    for (const fk of schema.tables.get(name)!.foreignKeys) {
      if (order.indexOf(fk.table) >= index) fk.columns.forEach((c) => columns.add(c));
    }
    for (const nameOfColumn of columns) {
      if (schema.tables.get(name)!.columns.find((c) => c.name === nameOfColumn)!.notNull) throw new Error('foreign_key_staging_not_nullable');
    }
    deferred.set(name, columns);
  }
  return { order, deferred };
}
function staged(row: ExportRecord, columns: Set<string>): ExportRecord {
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, columns.has(name) ? null : value]));
}
const MARKER = 'cloudflare_data_migration';
const MARKER_SQL = `CREATE TABLE ${MARKER} (id TEXT PRIMARY KEY CHECK(id='application'), migration_id TEXT NOT NULL, manifest_sha256 TEXT NOT NULL, database_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('importing','complete')), checkpoint TEXT NOT NULL)`;

interface ExpectedObject { type: string; name: string; tbl_name: string; sql: string }
async function expectedObjects(workspace: string): Promise<{ app: ExpectedObject[]; auth: ExpectedObject[] }> {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(await readFile(join(workspace, 'drizzle-d1', '0000_aplicacion.sql'), 'utf8'));
    const app = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL").all() as unknown as ExpectedObject[];
    const appNames = new Set(app.map((o) => o.name));
    db.exec(await readFile(join(workspace, 'drizzle-d1', '0001_auth.sql'), 'utf8'));
    const auth = (db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL").all() as unknown as ExpectedObject[]).filter((o) => !appNames.has(o.name));
    return { app, auth };
  } finally { db.close(); }
}
export async function assertDestinationSchema(executor: D1Executor, workspace: string): Promise<boolean> {
  const expected = await expectedObjects(workspace);
  const objects = await executor.execute(boundedQuery("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL"));
  const names = new Map(objects.map((o) => [String(o.name), o]));
  for (const o of expected.app) {
    const actual = names.get(o.name);
    if (!actual || actual.type !== o.type || String(actual.sql).trim() !== o.sql.trim()) throw new Error('destination_application_schema_mismatch');
  }
  const allowed = new Map([...expected.app, ...expected.auth].map((o) => [o.name, o]));
  for (const actual of objects) {
    const name = String(actual.name);
    if (name.startsWith('sqlite_') ||
      (name === 'd1_migrations' && actual.type === 'table' && actual.tbl_name === 'd1_migrations') ||
      (name === '_cf_KV' && actual.type === 'table' && actual.tbl_name === '_cf_KV')) continue;
    if (name === MARKER) {
      if (String(actual.sql).trim() !== MARKER_SQL) throw new Error('destination_marker_schema_mismatch');
      continue;
    }
    const o = allowed.get(name);
    if (!o || actual.type !== o.type || String(actual.sql).trim() !== o.sql.trim()) throw new Error('destination_unrelated_schema');
    if (expected.auth.includes(o) && o.type === 'table') {
      const count = (await executor.execute(boundedQuery(`SELECT count(*) AS n FROM ${q(o.name)}`)))[0]?.n;
      if (Number(count) !== 0) throw new Error('destination_auth_not_empty');
    }
  }
  return names.has(MARKER);
}
function asRecord(row: Record<string, unknown>, table: SqliteTable): ExportRecord {
  const record = Object.fromEntries(table.columns.map((c) => [c.name, row[c.name]])) as ExportRecord;
  assertRecordMatchesTable(record, table);
  return record;
}
async function* destinationRows(executor: D1Executor, table: SqliteTable): AsyncGenerator<ExportRecord> {
  let last: Scalar[] | undefined;
  const keys = table.primaryKey.map(q);
  const selected = table.columns.map((c) => q(c.name)).join(',');
  // Aggregate only, before returning any private rows. Adapt pagination to the
  // largest ACTUAL destination row, not an assumed small synthetic/source row.
  const largest = Number((await executor.execute(boundedQuery(
    `SELECT max(length(CAST(json_array(${selected}) AS BLOB))) AS max_bytes FROM ${q(table.name)}`,
  )))[0]?.max_bytes ?? 0);
  const overhead = table.columns.reduce((n, c) => n + c.name.length + 8, 512);
  if (!Number.isSafeInteger(largest) || largest < 0 || largest + overhead > MAX_QUERY_PAYLOAD_BYTES) throw new Error('destination_row_size_invalid');
  const pageSize = Math.max(1, Math.min(100, Math.floor(MAX_QUERY_PAYLOAD_BYTES / (largest + overhead))));
  while (true) {
    const where = last ? ` WHERE (${keys.join(',')}) > (${keys.map(() => '?').join(',')})` : '';
    const rows = await executor.execute(boundedQuery(`SELECT ${selected} FROM ${q(table.name)}${where} ORDER BY ${keys.join(',')} LIMIT ${pageSize}`, last ?? []));
    if (!rows.length) return;
    for (const item of rows) {
      const row = asRecord(item, table);
      const key = keyOf(row, table);
      if (last && compareKeys(last, key) >= 0) throw new Error('destination_keys_not_ordered');
      last = key;
      yield row;
    }
  }
}
/** Merge against the complete local export: destination must be an exact subset
 * of original staged/final rows. A migration ID alone never authorizes overwrite. */
async function verifySubset(executor: D1Executor, directory: string, manifest: MigrationManifest, schema: SqliteSchema, plan: ImportPlan): Promise<number> {
  let total = 0;
  for (const entry of manifest.tables) {
    const table = schema.tables.get(entry.name)!;
    const destination = destinationRows(executor, table)[Symbol.asyncIterator]();
    let current = await destination.next();
    try {
      for await (const row of readExportRows(directory, entry, table)) {
        if (current.done) continue;
        const cmp = compareKeys(keyOf(current.value, table), keyOf(row, table));
        if (cmp < 0) throw new Error('destination_row_unrelated');
        if (cmp === 0) {
          const actualHash = sha256(JSON.stringify(current.value));
          if (actualHash !== sha256(JSON.stringify(row)) && actualHash !== sha256(JSON.stringify(staged(row, plan.deferred.get(entry.name)!)))) {
            throw new Error('destination_row_hash_mismatch');
          }
          total++; current = await destination.next();
        }
      }
      if (!current.done) throw new Error('destination_row_unrelated');
    } finally { await destination.return?.(undefined); }
  }
  return total;
}
async function verifyComplete(executor: D1Executor, manifest: MigrationManifest, schema: SqliteSchema): Promise<void> {
  for (const entry of manifest.tables) {
    const hash = createHash('sha256');
    let rows = 0, bytes = 0;
    for await (const row of destinationRows(executor, schema.tables.get(entry.name)!)) { bytes += rowHashUpdate(hash, row).length; rows++; }
    const count = Number((await executor.execute(boundedQuery(`SELECT count(*) AS n FROM ${q(entry.name)}`)))[0]?.n);
    if (count !== entry.rowCount || rows !== count || bytes !== entry.byteCount || hash.digest('hex') !== entry.sha256) throw new Error('destination_table_verification_failed');
  }
  if ((await executor.execute(boundedQuery('PRAGMA foreign_key_check'))).length) throw new Error('destination_foreign_key_violation');
  const integrity = await executor.execute(boundedQuery('PRAGMA quick_check'));
  if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== 'ok') throw new Error('destination_integrity_check_failed');
}
export interface ImportOptions {
  manifestPath: string;
  schema: SqliteSchema;
  workspace: string;
  executor?: D1Executor;
  apply?: boolean;
  expectedDatabaseId?: string;
  expectedManifestSha256?: string;
  verifyOnly?: boolean;
}
export async function importOrVerify(options: ImportOptions): Promise<{
  mode: 'local-preflight' | 'destination-preflight' | 'verified';
  migrationId: string; manifestSha256: string; tables: number; rows: number; bytes: number; existingRows?: number;
}> {
  const { manifest, directory, manifestSha256 } = await readAndValidateManifest(options.manifestPath);
  if (manifest.target.schemaSha256 !== options.schema.hash) throw new Error('manifest_target_schema_mismatch');
  const plan = buildImportPlan(options.schema);
  for (const entry of manifest.tables) {
    const table = options.schema.tables.get(entry.name)!;
    if (entry.sourcePresent) {
      manifestHasOnlyExpectedColumns(entry, table);
      assertPgTargetCompatibility(entry.name, entry.columns, table.columns);
      if (new Set(entry.columns.map((c) => c.name)).size !== entry.columns.length) throw new Error('manifest_column_duplicate');
      for (const c of entry.columns) {
        if (c.policy !== COLUMN_POLICIES[`${entry.name}.${c.name}`]) throw new Error('manifest_credential_policy_mismatch');
      }
    } else if (entry.columns.length) throw new Error('manifest_absent_table_columns');
    // Validate all bytes/keys/counts/types and every insert limit BEFORE any writes.
    for await (const row of readExportRows(directory, entry, table)) {
      insertBatches(table, [staged(row, plan.deferred.get(entry.name)!)]);
      if (plan.deferred.get(entry.name)!.size) restorationQuery(table, row, plan.deferred.get(entry.name)!);
    }
  }
  const result = { migrationId: manifest.migrationId, manifestSha256, tables: manifest.summary.tableCount, rows: manifest.summary.rowCount, bytes: manifest.summary.byteCount };
  const executor = options.executor;
  if (!executor) {
    if (options.apply || options.verifyOnly) throw new Error('destination_required');
    return { mode: 'local-preflight', ...result };
  }
  const markerPresent = await assertDestinationSchema(executor, options.workspace);
  const markers = markerPresent ? await executor.execute(boundedQuery(`SELECT * FROM ${MARKER}`)) : [];
  if (markers.length > 1) throw new Error('destination_marker_invalid');
  const marker = markers[0];
  if (marker && (marker.id !== 'application' || marker.migration_id !== manifest.migrationId || marker.manifest_sha256 !== manifestSha256 || marker.database_id !== executor.databaseId ||
    !['importing', 'complete'].includes(String(marker.status)))) throw new Error('destination_migration_mismatch');
  const existingRows = await verifySubset(executor, directory, manifest, options.schema, plan);
  if (existingRows && !marker) throw new Error('destination_not_empty');
  if (options.verifyOnly) {
    if (!marker) throw new Error('destination_migration_marker_required');
    await verifyComplete(executor, manifest, options.schema);
    return { mode: 'verified', existingRows, ...result };
  }
  if (!options.apply) return { mode: 'destination-preflight', existingRows, ...result };
  if (options.expectedDatabaseId !== executor.databaseId || !/^[a-f0-9-]{36}$/i.test(executor.databaseId)) throw new Error('destination_database_confirmation_required');
  if (options.expectedManifestSha256 !== manifestSha256) throw new Error('manifest_hash_confirmation_required');
  if (marker?.status === 'complete') {
    await verifyComplete(executor, manifest, options.schema);
    return { mode: 'verified', existingRows, ...result };
  }
  if (!markerPresent) await executor.execute(boundedQuery(MARKER_SQL));
  if (!marker) await executor.execute(boundedQuery(`INSERT INTO ${MARKER} (id,migration_id,manifest_sha256,database_id,status,checkpoint) VALUES ('application',?,?,?,'importing','start')`,
    [manifest.migrationId, manifestSha256, executor.databaseId]));
  const entries = new Map(manifest.tables.map((t) => [t.name, t]));
  for (const name of plan.order) {
    const table = options.schema.tables.get(name)!;
    let batch: ExportRecord[] = [];
    let accepted = 0;
    const flush = async () => {
      const queries = insertBatches(table, batch);
      await executeBatches(executor, queries);
      accepted += batch.length;
      // Checkpoint only after every insert has been acknowledged. Never trust
      // it without a fresh full subset/hash check after ambiguous network loss.
      await checkpoint(executor, manifest.migrationId, `insert:${name}:${accepted}`);
      batch = [];
    };
    let batchBytes = 0;
    for await (const row of readExportRows(directory, entries.get(name)!, table)) {
      const projection = staged(row, plan.deferred.get(name)!);
      const size = Buffer.byteLength(JSON.stringify(projection));
      if (batch.length && (batch.length >= 100 || batchBytes + size > MAX_QUERY_PAYLOAD_BYTES)) { await flush(); batchBytes = 0; }
      batch.push(projection); batchBytes += size;
    }
    if (batch.length) await flush();
  }
  for (const name of plan.order) {
    const columns = plan.deferred.get(name)!;
    if (!columns.size) continue;
    const table = options.schema.tables.get(name)!;
    let accepted = 0;
    let pending: MigrationQuery[] = [];
    for await (const row of readExportRows(directory, entries.get(name)!, table)) {
      // Las referencias NULL ya están correctas en la fase de inserción.
      if ([...columns].some((column) => row[column] !== null)) {
        pending.push(restorationQuery(table, row, columns));
      }
      accepted++;
      if (accepted % 100 === 0) {
        await executeBatches(executor, pending);
        pending = [];
        await checkpoint(executor, manifest.migrationId, `references:${name}:${accepted}`);
      }
    }
    await executeBatches(executor, pending);
    await checkpoint(executor, manifest.migrationId, `references:${name}:${accepted}`);
  }
  await verifyComplete(executor, manifest, options.schema);
  await executor.execute(boundedQuery(`UPDATE ${MARKER} SET status='complete',checkpoint='all-counts-hashes-foreign-keys-verified' WHERE id='application' AND migration_id=?`, [manifest.migrationId]));
  return { mode: 'verified', existingRows, ...result };
}

async function executeBatches(executor: D1Executor, queries: MigrationQuery[]): Promise<void> {
  if (!executor.executeBatch) {
    for (const query of queries) await executor.execute(query);
    return;
  }
  let pending: MigrationQuery[] = [];
  for (const query of queries) {
    const candidate = [...pending, query];
    if (pending.length && (
      candidate.length > 100 ||
      Buffer.byteLength(JSON.stringify(candidate)) > MAX_QUERY_PAYLOAD_BYTES
    )) {
      await executor.executeBatch(pending);
      pending = [];
    }
    pending.push(query);
  }
  if (pending.length) await executor.executeBatch(pending);
}
function restorationQuery(table: SqliteTable, row: ExportRecord, columns: Set<string>): MigrationQuery {
  const names = [...columns];
  return boundedQuery(`UPDATE ${q(table.name)} SET ${names.map((c) => `${q(c)}=?`).join(',')} WHERE ${table.primaryKey.map((c) => `${q(c)}=?`).join(' AND ')}`,
    [...names.map((c) => row[c]!), ...table.primaryKey.map((c) => row[c]!)]);
}
async function checkpoint(executor: D1Executor, migrationId: string, value: string): Promise<void> {
  await executor.execute(boundedQuery(`UPDATE ${MARKER} SET checkpoint=? WHERE id='application' AND migration_id=? AND status='importing'`, [value, migrationId]));
}
