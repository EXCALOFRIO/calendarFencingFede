import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  APPLICATION_TABLES,
  HISTORICAL_FACT_TABLES,
  OPTIONAL_PRE_CUTOVER_TABLES,
  type SqliteSchema,
} from './schema';

export const MANIFEST_VERSION = 1;
export const MAX_STATEMENT_BYTES = 100 * 1024;
export const MAX_QUERY_PAYLOAD_BYTES = 900 * 1024;
export const MAX_BIND_PARAMETERS = 100;
export const MAX_IMPORT_BATCH_BYTES = 900 * 1024;
export const MAX_IMPORT_BATCH_ROWS = 250;

export interface ManifestColumn {
  name: string;
  sourceType: string;
  sourceUdt: string;
  nullable: boolean;
  ordinalPosition: number;
  policy?: 'null' | 'rotate' | 'zero';
  backfill?: string | number;
}

export interface ManifestChunk {
  file: string;
  index: number;
  rowCount: number;
  byteCount: number;
  sha256: string;
  firstKeyHash: string | null;
  lastKeyHash: string | null;
}

export interface ManifestTable {
  name: string;
  sourcePresent: boolean;
  columns: ManifestColumn[];
  rowCount: number;
  byteCount: number;
  sha256: string;
  chunks: ManifestChunk[];
}

export interface MigrationManifest {
  format: 'calendario-neon-d1-export';
  version: number;
  migrationId: string;
  createdAt: string;
  source: {
    engine: 'postgresql' | 'postgresql+verified-history';
    schema: 'public';
    isolation: 'repeatable read';
    history?: {
      baselineManifestSha256: string;
      latestManifestSha256: string;
      sqliteSha256: string;
      tables: readonly string[];
    };
  };
  target: {
    engine: 'sqlite-d1';
    schema: 'application';
    schemaSha256: string;
  };
  summary: {
    tableCount: number;
    rowCount: number;
    byteCount: number;
  };
  tables: ManifestTable[];
}

export interface SqliteTarget {
  schema: SqliteSchema;
  sqlPath: string;
}

export async function readTargetSchema(baseDirectory = process.cwd()): Promise<SqliteTarget> {
  const sqlPath = resolve(baseDirectory, 'drizzle-d1', '0000_aplicacion.sql');
  let sql: string;
  try {
    sql = await readFile(sqlPath, 'utf8');
  } catch {
    throw new Error('d1_target_schema_missing');
  }
  const { assertApplicationSchema, parseSqliteSchema } = await import('./schema');
  const schema = parseSqliteSchema(sql);
  assertApplicationSchema(schema);
  return { schema, sqlPath };
}

export function assertPgTargetCompatibility(
  table: string,
  sourceColumns: ManifestColumn[],
  destinationColumns: { name: string; declaredType: string }[],
): void {
  const destination = new Map(destinationColumns.map((column) => [column.name, column]));
  const source = new Map(sourceColumns.map((column) => [column.name, column]));
  for (const column of sourceColumns) {
    const target = destination.get(column.name);
    if (!target) throw new Error('source_target_column_mismatch');
    const sourceType = column.sourceType.toLowerCase();
    const sourceUdt = column.sourceUdt.toLowerCase();
    const actual = target.declaredType.toUpperCase();
    const expectsInteger =
      sourceType === 'boolean' ||
      sourceType.startsWith('timestamp') ||
      ['smallint', 'integer', 'bigint', 'int2', 'int4', 'int8'].includes(sourceType);
    const expectsText =
      !expectsInteger ||
      sourceType === 'date' ||
      sourceType === 'numeric' ||
      sourceType === 'decimal' ||
      sourceType === 'json' ||
      sourceType === 'jsonb' ||
      sourceUdt.startsWith('_') ||
      sourceType.endsWith('[]') ||
      sourceType === 'uuid';
    if (expectsInteger && !actual.includes('INTEGER')) {
      throw new Error('source_target_type_mismatch');
    }
    if (expectsText && !actual.includes('TEXT')) throw new Error('source_target_type_mismatch');
  }
  for (const target of destinationColumns) {
    if (source.has(target.name)) continue;
    if (!columnHasBackfill(table, target.name)) {
      throw new Error('source_target_column_mismatch');
    }
  }
}

export function columnHasBackfill(table: string, column: string): boolean {
  return (
    table === 'sport_ranking_publication' &&
    (column === 'date_basis' || column === 'revision')
  );
}

export async function readAndValidateManifest(path: string): Promise<{
  manifest: MigrationManifest;
  directory: string;
  manifestSha256: string;
}> {
  const manifestPath = resolve(path);
  if (basename(manifestPath).toLowerCase() !== 'manifest.json') {
    throw new Error('manifest_filename_invalid');
  }
  const raw = await readFile(manifestPath);
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (!isMigrationManifest(parsed)) throw new Error('manifest_invalid');
  const manifest = parsed;
  if (manifest.tables.length !== APPLICATION_TABLES.length) {
    throw new Error('manifest_inventory_invalid');
  }
  for (let index = 0; index < APPLICATION_TABLES.length; index += 1) {
    if (manifest.tables[index]?.name !== APPLICATION_TABLES[index]) {
      throw new Error('manifest_inventory_invalid');
    }
  }
  const sumRows = manifest.tables.reduce((sum, table) => sum + table.rowCount, 0);
  const sumBytes = manifest.tables.reduce((sum, table) => sum + table.byteCount, 0);
  if (
    sumRows !== manifest.summary.rowCount ||
    sumBytes !== manifest.summary.byteCount ||
    manifest.summary.tableCount !== APPLICATION_TABLES.length
  ) {
    throw new Error('manifest_summary_invalid');
  }
  if (manifest.migrationId !== computeMigrationId(manifest)) {
    throw new Error('manifest_migration_id_invalid');
  }
  for (const table of manifest.tables) {
    if (!table.sourcePresent && (!OPTIONAL_PRE_CUTOVER_TABLES.has(table.name as never) || table.rowCount !== 0)) {
      throw new Error('manifest_missing_table_invalid');
    }
    if (table.rowCount !== table.chunks.reduce((sum, chunk) => sum + chunk.rowCount, 0)) {
      throw new Error('manifest_chunk_summary_invalid');
    }
    if (table.byteCount !== table.chunks.reduce((sum, chunk) => sum + chunk.byteCount, 0)) {
      throw new Error('manifest_chunk_summary_invalid');
    }
    for (let index = 0; index < table.chunks.length; index += 1) {
      const chunk = table.chunks[index]!;
      if (
        chunk.index !== index ||
        basename(chunk.file) !== chunk.file ||
        chunk.file.includes('..') ||
        chunk.file !== `${table.name}-${String(index).padStart(5, '0')}.jsonl`
      ) {
        throw new Error('manifest_chunk_path_invalid');
      }
    }
    if (table.rowCount === 0 && table.chunks.length !== 0) {
      throw new Error('manifest_empty_table_invalid');
    }
  }
  return {
    manifest,
    directory: resolve(manifestPath, '..'),
    manifestSha256: createHash('sha256').update(raw).digest('hex'),
  };
}

export function computeMigrationId(
  manifest: Pick<MigrationManifest, 'target' | 'tables'>,
): string {
  const content = JSON.stringify({
    schemaSha256: manifest.target.schemaSha256,
    tables: manifest.tables.map(({ name, rowCount, byteCount, sha256 }) => ({
      name,
      rowCount,
      byteCount,
      sha256,
    })),
  });
  return createHash('sha256').update(content).digest('hex');
}

function isMigrationManifest(value: unknown): value is MigrationManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<MigrationManifest>;
  if (
    manifest.format !== 'calendario-neon-d1-export' ||
    manifest.version !== MANIFEST_VERSION ||
    typeof manifest.migrationId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.migrationId) ||
    typeof manifest.createdAt !== 'string' ||
    !manifest.source ||
    !['postgresql', 'postgresql+verified-history'].includes(manifest.source.engine) ||
    manifest.source.schema !== 'public' ||
    manifest.source.isolation !== 'repeatable read' ||
    !manifest.target ||
    manifest.target.engine !== 'sqlite-d1' ||
    manifest.target.schema !== 'application' ||
    !/^[a-f0-9]{64}$/.test(manifest.target.schemaSha256 ?? '') ||
    !manifest.summary ||
    !Number.isSafeInteger(manifest.summary.rowCount) ||
    !Number.isSafeInteger(manifest.summary.byteCount) ||
    !Array.isArray(manifest.tables)
  ) {
    return false;
  }
  const history = manifest.source.history;
  if (manifest.source.engine === 'postgresql') {
    if (history !== undefined) return false;
  } else if (!history ||
    ![history.baselineManifestSha256, history.latestManifestSha256, history.sqliteSha256]
      .every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) ||
    JSON.stringify(history.tables) !== JSON.stringify(HISTORICAL_FACT_TABLES)) return false;
  return manifest.tables.every((table) => {
    return (
      !!table &&
      typeof table.name === 'string' &&
      typeof table.sourcePresent === 'boolean' &&
      Number.isSafeInteger(table.rowCount) && table.rowCount >= 0 &&
      Number.isSafeInteger(table.byteCount) && table.byteCount >= 0 &&
      /^[a-f0-9]{64}$/.test(table.sha256) &&
      Array.isArray(table.columns) && table.columns.every((c: ManifestColumn) =>
        c && /^[a-z][a-z0-9_]*$/.test(c.name) && typeof c.sourceType === 'string' &&
        typeof c.sourceUdt === 'string' && typeof c.nullable === 'boolean' &&
        Number.isSafeInteger(c.ordinalPosition) && c.ordinalPosition > 0 &&
        (c.policy === undefined || ['null', 'rotate', 'zero'].includes(c.policy)) &&
        (c.backfill === undefined || typeof c.backfill === 'string' || Number.isSafeInteger(c.backfill))) &&
      Array.isArray(table.chunks) && table.chunks.every((c: ManifestChunk) =>
        c && typeof c.file === 'string' && Number.isSafeInteger(c.index) && c.index >= 0 &&
        Number.isSafeInteger(c.rowCount) && c.rowCount > 0 &&
        Number.isSafeInteger(c.byteCount) && c.byteCount > 0 && c.byteCount <= 8 * 1024 * 1024 &&
        /^[a-f0-9]{64}$/.test(c.sha256) && /^[a-f0-9]{64}$/.test(c.firstKeyHash ?? '') &&
        /^[a-f0-9]{64}$/.test(c.lastKeyHash ?? ''))
    );
  });
}

export function manifestHasOnlyExpectedColumns(
  table: ManifestTable,
  destination: { columns: { name: string; declaredType: string }[] },
): void {
  const sourceNames = new Set(table.columns.map((column) => column.name));
  const targetNames = new Set(destination.columns.map((column) => column.name));
  for (const sourceName of sourceNames) {
    if (!targetNames.has(sourceName)) throw new Error('source_target_column_mismatch');
  }
  for (const targetName of targetNames) {
    if (!sourceNames.has(targetName) && !columnHasBackfill(table.name, targetName)) {
      throw new Error('source_target_column_mismatch');
    }
  }
}
