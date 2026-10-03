import { createHash, randomBytes } from 'node:crypto';
import type { SqliteColumn, SqliteTable } from './schema';

export interface PgColumn {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  ordinalPosition: number;
}

export function quotePostgresIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) throw new Error('identifier_not_allowlisted');
  return `"${identifier}"`;
}

function normalizeTimestamp(value: string, withTimezone: boolean): number {
  let input = withTimezone
    ? value.includes('T')
      ? value
      : value.replace(' ', 'T')
    : `${value.replace(' ', 'T')}Z`;
  if (withTimezone && !/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(input)) {
    throw new Error('timestamp_timezone_missing');
  }
  if (withTimezone) input = input.replace(/([+-]\d{2})$/, '$1:00');
  const milliseconds = Date.parse(input);
  if (!Number.isSafeInteger(milliseconds)) throw new Error('timestamp_invalid');
  return milliseconds;
}

export function convertPgValue(
  value: unknown,
  source: PgColumn,
  destination: SqliteColumn,
): unknown {
  if (value === undefined) throw new Error('source_value_missing');
  if (value === null) return null;
  const raw = String(value);
  const type = source.dataType.toLowerCase();
  const udt = source.udtName.toLowerCase();

  if (type === 'boolean') {
    if (raw === 't' || raw === 'true') return 1;
    if (raw === 'f' || raw === 'false') return 0;
    throw new Error('boolean_invalid');
  }
  if (type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('date_invalid');
    const time = Date.parse(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== raw) {
      throw new Error('date_invalid');
    }
    return raw;
  }
  if (type === 'timestamp with time zone' || udt === 'timestamptz') {
    return normalizeTimestamp(raw, true);
  }
  if (type === 'timestamp without time zone' || udt === 'timestamp') {
    return normalizeTimestamp(raw, false);
  }
  if (type === 'json' || type === 'jsonb' || udt === 'json' || udt === 'jsonb') {
    // Keep JSON as text, avoiding JS number rounding of large JSON integers.
    JSON.parse(raw);
    if (!destination.declaredType.includes('TEXT')) throw new Error('json_target_not_text');
    return raw;
  }
  if (udt.startsWith('_') || type.endsWith('[]')) {
    if (!destination.declaredType.includes('TEXT')) throw new Error('array_target_not_text');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('array_json_invalid');
    return JSON.stringify(parsed);
  }
  if (type === 'numeric' || type === 'decimal') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) {
      throw new Error('decimal_invalid');
    }
    if (!destination.declaredType.includes('TEXT')) throw new Error('decimal_target_not_text');
    return raw;
  }
  if (type === 'uuid') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      throw new Error('uuid_invalid');
    }
    return raw;
  }
  if (
    type === 'smallint' ||
    type === 'integer' ||
    type === 'bigint' ||
    type === 'int2' ||
    type === 'int4' ||
    type === 'int8'
  ) {
    if (!/^-?\d+$/.test(raw)) throw new Error('integer_invalid');
    const number = Number(raw);
    if (!Number.isSafeInteger(number)) throw new Error('integer_not_safe');
    return number;
  }
  if (type === 'bytea' || udt === 'bytea') throw new Error('bytea_not_supported');
  if (
    destination.declaredType.includes('INTEGER') &&
    (raw === 't' || raw === 'f')
  ) {
    return raw === 't' ? 1 : 0;
  }
  if (destination.declaredType.includes('TEXT') || destination.declaredType === '') {
    return raw;
  }
  throw new Error('source_target_type_mismatch');
}

export function rotateApplicationKey(table: string, column: string): string | undefined {
  if (table === 'user_profile' && column === 'ical_token') {
    return randomBytes(32).toString('base64url');
  }
  return undefined;
}

export function rowHashUpdate(hash: ReturnType<typeof createHash>, row: unknown): Buffer {
  const serialized = `${JSON.stringify(row)}\n`;
  const bytes = Buffer.from(serialized, 'utf8');
  hash.update(bytes);
  return bytes;
}

export function sqliteValueFits(value: unknown, column: SqliteColumn): boolean {
  if (value === null) return !column.notNull;
  if (column.notNull && value === undefined) return false;
  if (column.declaredType.includes('INTEGER')) {
    return Number.isSafeInteger(value) || typeof value === 'bigint';
  }
  if (column.declaredType.includes('TEXT')) return typeof value === 'string';
  if (column.declaredType.includes('REAL')) {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (column.declaredType.includes('BLOB')) return Buffer.isBuffer(value);
  return typeof value === 'string' || typeof value === 'number';
}

export interface ExportRecord {
  [column: string]: string | number | null;
}

export function assertRecordMatchesTable(record: ExportRecord, table: SqliteTable): void {
  const expected = table.columns.map((column) => column.name);
  const actual = Object.keys(record);
  if (
    expected.length !== actual.length ||
    expected.some((column) => !Object.hasOwn(record, column))
  ) {
    throw new Error('row_column_mismatch');
  }
  for (const column of table.columns) {
    if (!sqliteValueFits(record[column.name], column)) throw new Error('row_value_type_mismatch');
    if (column.notNull && record[column.name] === null) throw new Error('row_null_not_allowed');
  }
}
