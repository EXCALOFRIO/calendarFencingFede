import { createHash } from 'node:crypto';
import { open, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APPLICATION_TABLES, COLUMN_POLICIES, SAFE_BACKFILLS, OPTIONAL_PRE_CUTOVER_TABLES,
  type SqliteSchema, type SqliteTable,
} from './schema';
import { convertPgValue, quotePostgresIdentifier as q, rotateApplicationKey, assertRecordMatchesTable, type ExportRecord } from './codec';
import { assertPgTargetCompatibility, computeMigrationId, MANIFEST_VERSION, type ManifestColumn, type ManifestTable, type MigrationManifest } from './manifest';
import { assertCapacity, keyOf, compareKeys, sha256 } from './files';

/** Injectable source: a dedicated Pool client, never the application's SQLite index. */
export interface PgSnapshotClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
const PAGE_ROWS = 100;
const CHUNK_BYTES = 4 * 1024 * 1024;
export function sourceSelectExpression(table: string, column: ManifestColumn): string {
  const name = q(column.name);
  if (COLUMN_POLICIES[`${table}.${column.name}`]) return `NULL::text AS ${name}`;
  const array = column.sourceType === 'ARRAY' || column.sourceUdt.startsWith('_');
  return `${array ? `to_json(${name})` : name}::text AS ${name}`;
}
export function convertSourceRow(table: SqliteTable, columns: ManifestColumn[], row: Record<string, unknown>): ExportRecord {
  const source = new Map(columns.map((c) => [c.name, c]));
  const record: ExportRecord = {};
  for (const target of table.columns) {
    const policy = COLUMN_POLICIES[`${table.name}.${target.name}`];
    if (policy === 'null') record[target.name] = null;
    else if (policy === 'zero') record[target.name] = 0;
    else if (policy === 'rotate') record[target.name] = rotateApplicationKey(table.name, target.name)!;
    else if (!source.has(target.name)) {
      const backfill = SAFE_BACKFILLS[`${table.name}.${target.name}`];
      if (backfill === undefined) throw new Error('source_target_column_mismatch');
      record[target.name] = backfill;
    } else {
      const c = source.get(target.name)!;
      record[target.name] = convertPgValue(row[target.name], {
        name: c.name, dataType: c.sourceType, udtName: c.sourceUdt,
        nullable: c.nullable, ordinalPosition: c.ordinalPosition,
      }, target) as string | number | null;
    }
  }
  assertRecordMatchesTable(record, table);
  return record;
}
export async function exportSnapshot(client: PgSnapshotClient, schema: SqliteSchema, directory: string): Promise<MigrationManifest> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    const state = (await client.query("SELECT current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS isolation")).rows[0];
    if (state?.ro !== 'on' || state?.isolation !== 'repeatable read') throw new Error('source_snapshot_not_readonly');
    const inventory = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")).rows.map((r) => String(r.table_name));
    const expected = new Set<string>(APPLICATION_TABLES);
    if (inventory.some((name) => !expected.has(name) && name !== '__drizzle_migrations')) throw new Error('source_public_inventory_unexpected');
    const tables: ManifestTable[] = [];
    for (const name of APPLICATION_TABLES) {
      const table = schema.tables.get(name)!;
      const present = inventory.includes(name);
      if (!present && !OPTIONAL_PRE_CUTOVER_TABLES.has(name)) throw new Error('source_required_table_missing');
      const catalog = present ? (await client.query(
        "SELECT column_name, data_type, udt_name, is_nullable, ordinal_position FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [name],
      )).rows : [];
      const columns: ManifestColumn[] = catalog.map((c) => ({
        name: String(c.column_name), sourceType: String(c.data_type), sourceUdt: String(c.udt_name),
        nullable: c.is_nullable === 'YES', ordinalPosition: Number(c.ordinal_position),
        ...(COLUMN_POLICIES[`${name}.${c.column_name}`] ? { policy: COLUMN_POLICIES[`${name}.${c.column_name}`] } : {}),
      }));
      if (present) assertPgTargetCompatibility(name, columns, table.columns);
      const count = present ? Number((await client.query(`SELECT count(*)::text AS count FROM public.${q(name)}`)).rows[0]?.count) : 0;
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('source_count_invalid');
      const estimated = present ? Number((await client.query('SELECT pg_total_relation_size($1::regclass)::text AS bytes', [`public.${name}`])).rows[0]?.bytes) : 0;
      await assertCapacity(directory, Math.max(estimated * 3, 16 * 1024 * 1024));
      const entry: ManifestTable = { name, sourcePresent: present, columns, rowCount: 0, byteCount: 0, sha256: '', chunks: [] };
      const hash = createHash('sha256');
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let chunkHash = createHash('sha256'), chunkRows = 0, chunkBytes = 0;
      let firstKeyHash: string | null = null, lastKeyHash: string | null = null;
      let last: ReturnType<typeof keyOf> | undefined;
      const finishChunk = async () => {
        if (!handle) return;
        await handle.sync(); await handle.close(); handle = undefined;
        entry.chunks.push({
          file: `${name}-${String(entry.chunks.length).padStart(5, '0')}.jsonl`,
          index: entry.chunks.length, rowCount: chunkRows, byteCount: chunkBytes,
          sha256: chunkHash.digest('hex'), firstKeyHash, lastKeyHash,
        });
        chunkHash = createHash('sha256'); chunkRows = 0; chunkBytes = 0; firstKeyHash = null; lastKeyHash = null;
      };
      try {
        if (present) {
          // PostgreSQL cursors remain inside this single read-only snapshot.
          const order = table.primaryKey.map((key) => {
            const target = table.columns.find((c) => c.name === key)!;
            return target.declaredType === 'INTEGER' ? q(key) : `${q(key)}::text COLLATE "C"`;
          }).join(',');
          await client.query(`DECLARE migration_rows NO SCROLL CURSOR FOR SELECT ${columns.map((c) => sourceSelectExpression(name, c)).join(',')} FROM public.${q(name)} ORDER BY ${order}`);
          while (true) {
            const page = (await client.query(`FETCH FORWARD ${PAGE_ROWS} FROM migration_rows`)).rows;
            if (!page.length) break;
            for (const sourceRow of page) {
              const record = convertSourceRow(table, columns, sourceRow);
              const key = keyOf(record, table);
              if (last && compareKeys(last, key) >= 0) throw new Error('source_keys_not_ordered');
              last = key;
              const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
              if (bytes.length > 880 * 1024) throw new Error('export_row_exceeds_d1_payload');
              if (chunkBytes + bytes.length > CHUNK_BYTES) await finishChunk();
              if (!handle) {
                await assertCapacity(directory, CHUNK_BYTES * 3);
                handle = await open(join(directory, `${name}-${String(entry.chunks.length).padStart(5, '0')}.jsonl`), 'wx', 0o600);
              }
              await handle.writeFile(bytes);
              hash.update(bytes); chunkHash.update(bytes);
              entry.rowCount++; entry.byteCount += bytes.length; chunkRows++; chunkBytes += bytes.length;
              lastKeyHash = sha256(JSON.stringify(key)); firstKeyHash ??= lastKeyHash;
            }
          }
          await client.query('CLOSE migration_rows');
        }
        await finishChunk();
      } finally { if (handle) await handle.close(); }
      if (count !== entry.rowCount) throw new Error('source_snapshot_count_mismatch');
      entry.sha256 = hash.digest('hex'); tables.push(entry);
    }
    const manifest: MigrationManifest = {
      format: 'calendario-neon-d1-export', version: MANIFEST_VERSION, migrationId: '', createdAt: new Date().toISOString(),
      source: { engine: 'postgresql', schema: 'public', isolation: 'repeatable read' },
      target: { engine: 'sqlite-d1', schema: 'application', schemaSha256: schema.hash },
      summary: { tableCount: tables.length, rowCount: tables.reduce((s, t) => s + t.rowCount, 0), byteCount: tables.reduce((s, t) => s + t.byteCount, 0) },
      tables,
    };
    manifest.migrationId = computeMigrationId(manifest);
    // Publish only after all files and counts have passed; partial failures lack manifest.json.
    await writeFile(join(directory, 'manifest.pending'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(join(directory, 'manifest.pending'), join(directory, 'manifest.json'));
    return manifest;
  } finally { await client.query('ROLLBACK'); }
}
