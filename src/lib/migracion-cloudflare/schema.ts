import { createHash } from 'node:crypto';

/**
 * Fixed application inventory from the legacy PostgreSQL schema modules.
 * The Neon-managed `neon_auth` schema, PostgreSQL internals, and Drizzle's
 * migration table are deliberately outside this list.
 */
export const APPLICATION_TABLES = [
  'club',
  'user_profile',
  'athlete',
  'athlete_weapon',
  'season',
  'season_category',
  'profile_weapon',
  'event',
  'event_link',
  'event_competition',
  'event_deadline',
  'competition_registration',
  'event_document',
  'official_document',
  'ingest_run',
  'ingest_quarantine',
  'deadline_rule',
  'ranking_rule',
  'config_change_log',
  'entry',
  'entry_event_log',
  'submission',
  'call_up',
  'call_up_athlete',
  'notification',
  'club_skermo_settings',
  'live_source',
  'result',
  'official_ranking_entry',
  'ranking_point',
  'ranking_snapshot',
  'extraction_proposal',
  'fie_fencer',
  'fie_world_ranking',
  'fie_clasificacion',
  'extraccion_documento',
  'extraccion_propuesta',
  'documento_vigencia',
  'sport_person',
  'sport_person_alias',
  'sport_external_id',
  'sport_registration_ref',
  'sport_link_candidate',
  'sport_edition',
  'sport_competition',
  'sport_result',
  'sport_bout',
  'sport_ranking_publication',
  'sport_ranking_entry',
  'sport_favorite',
  'sport_import_coverage',
  'cron_execution',
  'sport_write_lease',
  'sport_incremental_task',
] as const;

export type ApplicationTable = (typeof APPLICATION_TABLES)[number];

/** Facts-first staging may replace only these source-owned historical tables. */
export const HISTORICAL_FACT_TABLES = [
  'sport_edition', 'sport_competition', 'sport_result', 'sport_bout', 'sport_import_coverage',
] as const satisfies readonly ApplicationTable[];

export const TABLE_IMPORT_ORDER: readonly ApplicationTable[] = [
  'club',
  'season',
  'user_profile',
  'athlete',
  'season_category',
  'athlete_weapon',
  'profile_weapon',
  'event',
  'event_link',
  'event_competition',
  'event_deadline',
  'event_document',
  'official_document',
  'ingest_run',
  'ingest_quarantine',
  'deadline_rule',
  'ranking_rule',
  'config_change_log',
  'competition_registration',
  'entry',
  'entry_event_log',
  'submission',
  'call_up',
  'call_up_athlete',
  'notification',
  'club_skermo_settings',
  'live_source',
  'result',
  'official_ranking_entry',
  'ranking_point',
  'ranking_snapshot',
  'extraction_proposal',
  'fie_fencer',
  'fie_world_ranking',
  'fie_clasificacion',
  'extraccion_documento',
  'extraccion_propuesta',
  'documento_vigencia',
  'sport_person',
  'sport_person_alias',
  'sport_external_id',
  'sport_registration_ref',
  'sport_link_candidate',
  'sport_edition',
  'sport_competition',
  'sport_result',
  'sport_bout',
  'sport_ranking_publication',
  'sport_ranking_entry',
  'sport_favorite',
  'sport_import_coverage',
  'cron_execution',
  'sport_write_lease',
  'sport_incremental_task',
];

/** Tables introduced by the last PostgreSQL migrations may not exist yet. */
export const OPTIONAL_PRE_CUTOVER_TABLES = new Set<ApplicationTable>([
  'cron_execution',
  'sport_write_lease',
  'sport_incremental_task',
]);

/**
 * Credentials are not application facts to carry over. The managed Neon Auth
 * identity ID is preserved: it is a foreign reference, never a credential.
 * The iCal bearer token is rotated locally so imported profiles still have a
 * working feed URL without exporting the old account key.
 */
export const COLUMN_POLICIES: Readonly<
  Record<string, 'null' | 'rotate' | 'zero'>
> = Object.freeze({
  'user_profile.ical_token': 'rotate',
  'club_skermo_settings.encrypted_password': 'null',
  'club_skermo_settings.credential_stored_at': 'null',
  'club_skermo_settings.direct_submit_enabled': 'zero',
});

/** Additive fields in 0021 which did not exist on older source databases. */
export const SAFE_BACKFILLS: Readonly<Record<string, string | number>> = Object.freeze({
  'sport_ranking_publication.date_basis': 'observed',
  'sport_ranking_publication.revision': 1,
});

export interface SqliteColumn {
  name: string;
  declaredType: string;
  primaryKeyPosition: number;
  notNull: boolean;
}

export interface SqliteTable {
  name: string;
  columns: SqliteColumn[];
  primaryKey: string[];
  sql: string;
  foreignKeys: { columns: string[]; table: string; targetColumns: string[] }[];
}

export interface SqliteSchema {
  tables: Map<string, SqliteTable>;
  hash: string;
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    const quote = trimmed[0]!;
    const close = quote === '[' ? ']' : quote;
    return trimmed.slice(1, -1).replaceAll(`${close}${close}`, close);
  }
  return trimmed;
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | '`' | ']' | null = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) {
        if (text[i + 1] === quote && quote !== ']') {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '[') {
      quote = ']';
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('schema_sql_unbalanced');
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | '`' | ']' | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) {
        if (text[i + 1] === quote && quote !== ']') {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '[') {
      quote = ']';
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function firstIdentifier(definition: string): { name: string; rest: string } {
  const trimmed = definition.trim();
  const quoted = trimmed.match(/^("(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:]]|[^\]])*\])/);
  if (quoted) {
    return {
      name: unquoteIdentifier(quoted[0]),
      rest: trimmed.slice(quoted[0].length).trim(),
    };
  }
  const plain = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  if (!plain) throw new Error('schema_sql_identifier_invalid');
  return { name: plain[1]!, rest: trimmed.slice(plain[0].length).trim() };
}

export function parseSqliteSchema(sql: string): SqliteSchema {
  const tables = new Map<string, SqliteTable>();
  const createPattern =
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)?("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;
  for (const match of sql.matchAll(createPattern)) {
    const index = match.index!;
    const openIndex = index + match[0].lastIndexOf('(');
    const closeIndex = findMatchingParen(sql, openIndex);
    const name = unquoteIdentifier(match[1]!);
    if (!/^[a-z][a-z0-9_]*$/.test(name) || tables.has(name)) {
      throw new Error('schema_sql_table_invalid');
    }
    const definitions = splitTopLevel(sql.slice(openIndex + 1, closeIndex));
    const columns: SqliteColumn[] = [];
    const tablePrimaryKey: string[] = [];
    const foreignKeys: SqliteTable['foreignKeys'] = [];

    for (const definition of definitions) {
      if (/^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(definition)) {
        const fk = definition.match(/FOREIGN\s+KEY\s*\((.*?)\)\s*REFERENCES\s*([^\s(]+)\s*\((.*?)\)/i);
        if (fk) foreignKeys.push({
          columns: splitTopLevel(fk[1]!).map((v) => firstIdentifier(v).name),
          table: unquoteIdentifier(fk[2]!),
          targetColumns: splitTopLevel(fk[3]!).map((v) => firstIdentifier(v).name),
        });
        const pk = definition.match(/^PRIMARY\s+KEY\s*\(([\s\S]*?)\)/i);
        if (pk) {
          tablePrimaryKey.push(
            ...splitTopLevel(pk[1]!).map((column) => firstIdentifier(column).name),
          );
        }
        continue;
      }
      const { name: columnName, rest } = firstIdentifier(definition);
      if (!/^[a-z][a-z0-9_]*$/.test(columnName) || columns.some((column) => column.name === columnName)) {
        throw new Error('schema_sql_column_invalid');
      }
      const typeMatch = rest.match(/^([A-Za-z][A-Za-z0-9_]*)/);
      const declaredType = typeMatch?.[1]?.replace(/\s+/g, ' ').toUpperCase() ?? '';
      const inlinePrimaryKey = /\bPRIMARY\s+KEY\b/i.test(rest);
      const primaryKeyPosition = inlinePrimaryKey ? columns.length + 1 : 0;
      columns.push({
        name: columnName,
        declaredType,
        primaryKeyPosition,
        notNull: /\bNOT\s+NULL\b/i.test(rest) || inlinePrimaryKey,
      });
    }
    if (tablePrimaryKey.length) {
      for (const column of columns) {
        column.primaryKeyPosition = tablePrimaryKey.indexOf(column.name) + 1;
        if (column.primaryKeyPosition === 0) continue;
        column.notNull = true;
      }
    }
    const primaryKey = columns
      .filter((column) => column.primaryKeyPosition > 0)
      .sort((a, b) => a.primaryKeyPosition - b.primaryKeyPosition)
      .map((column) => column.name);
    if (!columns.length || !primaryKey.length) throw new Error('schema_sql_primary_key_missing');
    tables.set(name, { name, columns, primaryKey, sql: sql.slice(index, closeIndex + 1), foreignKeys });
  }

  if (!tables.size) throw new Error('schema_sql_no_tables');
  // Pin constraints, indexes and defaults too, not only the column inventory.
  const hash = createHash('sha256').update(sql).digest('hex');
  return { tables, hash };
}

export function assertApplicationSchema(schema: SqliteSchema): void {
  const expected = new Set<string>(APPLICATION_TABLES);
  const actual = new Set(schema.tables.keys());
  const missing = [...expected].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.has(name));
  if (missing.length || extra.length) throw new Error('schema_sql_inventory_mismatch');
  if (TABLE_IMPORT_ORDER.length !== APPLICATION_TABLES.length) {
    throw new Error('import_order_inventory_mismatch');
  }
  if (new Set(TABLE_IMPORT_ORDER).size !== APPLICATION_TABLES.length) {
    throw new Error('import_order_duplicate');
  }
  for (const table of APPLICATION_TABLES) {
    if (!schema.tables.get(table)?.primaryKey.length) {
      throw new Error('schema_sql_primary_key_missing');
    }
  }
}

export function quoteSqliteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) throw new Error('identifier_not_allowlisted');
  return `"${identifier}"`;
}
