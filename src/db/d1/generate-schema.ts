/**
 * Offline catalog compiler, NEVER imported by the application.
 * Converts Drizzle's PostgreSQL column/constraint metadata, not PostgreSQL SQL.
 * Unknown types/defaults fail closed. Migration-only additions are explicit.
 * Run: npx tsx src/db/d1/generate-schema.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getTableColumns, is, SQL } from 'drizzle-orm';
import { getTableConfig, isPgEnum, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import * as legacy from '../legacy-postgres/schema';

const root = new URL('../../../', import.meta.url);
const dialect = new PgDialect();
const entries: [string, unknown][] = Object.entries(legacy);
const tables = entries.filter((entry): entry is [string, PgTable] => is(entry[1], PgTable));
const tableExports = new Map(tables.map(([name, table]) => [getTableConfig(table).name, name]));
const quote = (value: string) => JSON.stringify(value);
const sqlText = (value: SQL) => {
  const query = dialect.sqlToQuery(value);
  if (query.params.length) throw new Error('Parameterized catalog expression needs an explicit D1 mapping.');
  return query.sql;
};
const literal = (value: SQL) => `sql.raw(${quote(sqlText(value))})`;
const enumExports = Object.entries(legacy).filter(([, value]) => isPgEnum(value));
const enumSource = enumExports.map(([name, value]) => {
  if (!isPgEnum(value)) throw new Error('Expected enum.');
  return `export const ${name} = sqliteEnum(${quote(value.enumName)}, ${JSON.stringify(value.enumValues)});`;
}).join('\n');

const manifest: Record<string, unknown>[] = [];
const blocks = tables.map(([exportName, table]) => {
  const config = getTableConfig(table);
  const propertyByName = new Map(Object.entries(getTableColumns(table)).map(([property, column]) => [column.name, property]));
  const col = (name: string) => `t.${propertyByName.get(name) ?? (() => { throw new Error(`Missing ${config.name}.${name}`); })()}`;
  const checks: string[] = [];
  const fields = config.columns.map((column) => {
    const property = propertyByName.get(column.name)!;
    const q = quote(column.name);
    let builder: string;
    let storage: string;
    switch (column.columnType) {
      case 'PgUUID': builder = `text(${q})`; storage = 'text:uuid'; break;
      case 'PgText':
      case 'PgEnumColumn':
        builder = column.enumValues?.length
          ? `text(${q}, { enum: ${JSON.stringify(column.enumValues)} })`
          : `text(${q})`;
        storage = column.enumValues?.length ? 'text:enum' : 'text';
        break;
      case 'PgDateString': builder = `text(${q})`; storage = 'text:date-only'; break;
      case 'PgTimestamp': builder = `timestampMilliseconds(${q})`; storage = 'integer:epoch-milliseconds:Date'; break;
      case 'PgBoolean': builder = `integer(${q}, { mode: 'boolean' })`; storage = 'integer:boolean'; break;
      case 'PgInteger':
      case 'PgSmallInt':
      case 'PgBigInt53': builder = `integer(${q})`; storage = 'integer:number'; break;
      case 'PgNumeric': builder = `decimalText(${q})`; storage = 'text:decimal-string'; break;
      case 'PgJsonb':
        builder = `jsonText<typeof legacy.${exportName}.$inferSelect[${quote(property)}]>(${q})`;
        storage = 'text:json';
        break;
      // No array columns exist through 0020/current source. Never silently convert
      // future arrays: dimensional bounds/null elements need an explicit contract.
      default: throw new Error(`Unmapped ${config.name}.${column.name}: ${column.columnType}`);
    }
    let defaultSql: string | number | boolean | undefined;
    if (column.default !== undefined) {
      if (is(column.default, SQL)) {
        defaultSql = sqlText(column.default);
        if (defaultSql === 'gen_random_uuid()' && column.columnType === 'PgUUID') builder += '.default(uuidV4)';
        else if (defaultSql === 'now()' && column.columnType === 'PgTimestamp') builder += '.default(nowMilliseconds)';
        else throw new Error(`Unmapped default ${config.name}.${column.name}: ${defaultSql}`);
      } else if (typeof column.default === 'string' || typeof column.default === 'number' || typeof column.default === 'boolean') {
        defaultSql = column.default;
        builder += `.default(${JSON.stringify(column.default)})`;
      } else throw new Error(`Unmapped default ${config.name}.${column.name}`);
    }
    if (column.notNull) builder += '.notNull()';
    if (column.primary) builder += '.primaryKey()';
    if (column.isUnique) builder += `.unique(${quote(column.uniqueName ?? `${config.name}_${column.name}_unique`)})`;
    if (column.enumValues?.length) {
      const values = column.enumValues.map((v) => `'${v.replaceAll("'", "''")}'`).join(', ');
      checks.push(`check(${quote(`${config.name}_${column.name}_enum`)}, sql.raw(${quote(`${q} IN (${values})`)}))`);
    }
    if (storage === 'integer:boolean') checks.push(`check(${quote(`${config.name}_${column.name}_boolean`)}, sql.raw(${quote(`${q} IS NULL OR (typeof(${q}) = 'integer' AND ${q} IN (0, 1))`)}))`);
    if (storage.startsWith('integer:') && storage !== 'integer:boolean') {
      let range = '';
      if (column.columnType === 'PgSmallInt') range = ` AND ${q} BETWEEN -32768 AND 32767`;
      if (column.columnType === 'PgInteger') range = ` AND ${q} BETWEEN -2147483648 AND 2147483647`;
      if (column.columnType === 'PgBigInt53' || column.columnType === 'PgTimestamp') range = ` AND ${q} BETWEEN -9007199254740991 AND 9007199254740991`;
      checks.push(`check(${quote(`${config.name}_${column.name}_integer`)}, sql.raw(${quote(`${q} IS NULL OR (typeof(${q}) = 'integer'${range})`)}))`);
    }
    if (storage === 'text:json') checks.push(`check(${quote(`${config.name}_${column.name}_json`)}, sql.raw(${quote(`${q} IS NULL OR (typeof(${q}) = 'text' AND json_valid(${q}))`)}))`);
    manifest.push({
      table: config.name, export: exportName, property, column: column.name,
      postgresType: column.getSQLType(), postgresColumnType: column.columnType,
      storage, nullable: !column.notNull, default: defaultSql ?? null,
    });
    return `  ${property}: ${builder},`;
  });
  const constraints = [
    ...config.primaryKeys.map((key) => `primaryKey({ name: ${quote(key.getName())}, columns: [${key.columns.map((c) => col(c.name)).join(', ')}] })`),
    ...config.uniqueConstraints.map((key) => {
      if (key.nullsNotDistinct) throw new Error(`NULLS NOT DISTINCT needs explicit mapping: ${key.name}`);
      return `unique(${quote(key.getName() ?? `${config.name}_${key.columns.map((c) => c.name).join('_')}_unique`)}).on(${key.columns.map((c) => col(c.name)).join(', ')})`;
    }),
    ...config.foreignKeys.map((key) => {
      const reference = key.reference();
      const foreignTable = tableExports.get(getTableConfig(reference.foreignTable).name)!;
      const foreignProperties = new Map(Object.entries(getTableColumns(reference.foreignTable)).map(([p, c]) => [c.name, p]));
      return `foreignKey({ name: ${quote(key.getName())}, columns: [${reference.columns.map((c) => col(c.name)).join(', ')}], foreignColumns: [${reference.foreignColumns.map((c) => `${foreignTable}.${foreignProperties.get(c.name)}`).join(', ')}] }).onDelete(${quote(key.onDelete ?? 'no action')}).onUpdate(${quote(key.onUpdate ?? 'no action')})`;
    }),
    ...config.indexes.map(({ config: index }) => {
      if (index.method !== 'btree') throw new Error(`Unmapped index method ${index.name}`);
      const columns = index.columns.map((c) => {
        if (is(c, SQL)) throw new Error(`Expression index requires explicit mapping ${index.name}`);
        // text_pattern_ops maps to SQLite's binary text B-tree, not PG opclasses.
        if (!('name' in c) || typeof c.name !== 'string') throw new Error(`Missing index column ${index.name}`);
        return col(c.name);
      });
      return `${index.unique ? 'uniqueIndex' : 'index'}(${quote(index.name!)}).on(${columns.join(', ')})${index.where ? `.where(${literal(index.where)})` : ''}`;
    }),
    ...config.checks.map((constraint) => {
      if (constraint.name === 'sport_person_no_self_merge') {
        return `check("sport_person_no_self_merge", sql.raw('"merged_into_person_id" IS NOT "id"'))`;
      }
      return `check(${quote(constraint.name)}, ${literal(constraint.value)})`;
    }),
    ...checks,
  ];
  // These applied migration constraints/indexes are missing from the PG TS catalog.
  if (config.name === 'deadline_rule') {
    constraints.push(
      `check("deadline_rule_weekday_iso", sql.raw('"weekday" IS NULL OR "weekday" BETWEEN 1 AND 7'))`,
      `check("deadline_rule_time_of_day_hhmm", sql.raw('"time_of_day" IS NULL OR (length("time_of_day") = 5 AND "time_of_day" GLOB \\'[0-2][0-9]:[0-5][0-9]\\' AND substr("time_of_day", 1, 2) <= \\'23\\')'))`,
    );
  }
  if (config.name === 'official_document') constraints.push(`index("official_document_sin_hash_idx").on(t.id).where(sql.raw('"file_hash" IS NULL'))`);
  return `export const ${exportName} = sqliteTable(${quote(config.name)}, {\n${fields.join('\n')}\n}, (t): SQLiteTableExtraConfigValue[] => [\n${constraints.map((c) => `  ${c},`).join('\n')}\n]);`;
});

await writeFile(new URL('src/db/d1/enums.ts', root), `// Offline-generated domain values. No PostgreSQL runtime dependency.\nimport { sqliteEnum } from './columns';\n\n${enumSource}\n`);
await writeFile(new URL('src/db/d1/schema.ts', root), `// Offline-generated from legacy Drizzle metadata plus applied migration-only constraints.\n// Edit the catalog compiler/mappings, then regenerate. Never import legacy at runtime.\nimport { sql } from 'drizzle-orm';\nimport { sqliteTable, integer, text, index, uniqueIndex, unique, primaryKey, foreignKey, check, type SQLiteTableExtraConfigValue } from 'drizzle-orm/sqlite-core';\nimport type * as legacy from '../legacy-postgres/schema';\nimport { timestampMilliseconds, decimalText, jsonText, nowMilliseconds, uuidV4 } from './columns';\n\n${blocks.join('\n\n')}\n`);
await mkdir(new URL('drizzle-d1/meta/', root), { recursive: true });
await writeFile(new URL('drizzle-d1/serialization.json', root), `${JSON.stringify({
  source: 'PostgreSQL application public schema through applied 0020; safe table/column additions from unapplied 0021 only',
  tables: tables.length,
  columns: manifest.length,
  arrays: 'No PostgreSQL array columns in the applied migrations or current catalog. Unknown array types fail closed.',
  excluded: ['neon_auth (managed separately)', '0021 PostgreSQL functions and statement-level write-fence triggers'],
  fields: manifest,
}, null, 2)}\n`);
console.log(`Generated ${tables.length} D1 tables, ${manifest.length} columns at ${fileURLToPath(root)}.`);
