import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { getTableColumns, is, SQL } from 'drizzle-orm';
import { getTableConfig as pgConfig, PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as legacy from '../src/db/legacy-postgres/schema';
import * as schema from '../src/db/schema';
import { localD1 } from '../src/db/d1/testing';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Tables = { [K in keyof typeof schema]: typeof schema[K] extends SQLiteTable ? K : never }[keyof typeof schema];
type SelectParity = {
  [K in Tables]: typeof legacy[K] extends PgTable
    ? Same<typeof schema[K]['$inferSelect'], typeof legacy[K]['$inferSelect']> : false;
}[Tables];
type InsertParity = {
  [K in Tables]: typeof legacy[K] extends PgTable
    ? Same<typeof schema[K]['$inferInsert'], typeof legacy[K]['$inferInsert']> : false;
}[Tables];
// Every table's existing select DTO must remain identical, including JSON types.
const selectDtoParity: Exclude<SelectParity, true> extends never ? true : false = true;
const insertDtoParity: Exclude<InsertParity, true> extends never ? true : false = true;
const legacyEntries: [string, unknown][] = Object.entries(legacy);
const tables = legacyEntries.filter((entry): entry is [string, PgTable] => is(entry[1], PgTable));
const d1Entries: [string, unknown][] = Object.entries(schema);
const d1Tables = d1Entries.filter((entry): entry is [string, SQLiteTable] => is(entry[1], SQLiteTable));
const migration = readFileSync(new URL('../drizzle-d1/0000_aplicacion.sql', import.meta.url), 'utf8');
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((close) => close()); });
function database() {
  const local = localD1();
  cleanups.push(local.close);
  return local.sqlite;
}
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

describe('D1 native schema inventory and storage', () => {
  it('applies all 54 tables and 681 columns to built-in SQLite', () => {
    const sqlite = database();
    const physical = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    expect(physical.map((r) => r.name).sort()).toEqual(tables.map(([, t]) => pgConfig(t).name).sort());
    expect(d1Tables).toHaveLength(54);
    expect(selectDtoParity).toBe(true);
    expect(insertDtoParity).toBe(true);
    let count = 0;
    for (const [name, source] of tables) {
      const target = d1Tables.find(([key]) => key === name)![1];
      const sourceColumns = Object.entries(getTableColumns(source));
      const targetColumns = Object.entries(getTableColumns(target));
      expect(targetColumns.map(([p, c]) => [p, c.name, c.notNull])).toEqual(sourceColumns.map(([p, c]) => [p, c.name, c.notNull]));
      const physicalColumns = sqlite.prepare(`PRAGMA table_info(${identifier(pgConfig(source).name)})`).all();
      expect(physicalColumns.map((r) => r.name).sort()).toEqual(sourceColumns.map(([, c]) => c.name).sort());
      count += physicalColumns.length;
      for (const column of physicalColumns) {
        const legacyColumn = sourceColumns.find(([, c]) => c.name === column.name)![1];
        const integer = ['PgBoolean', 'PgSmallInt', 'PgInteger', 'PgBigInt53', 'PgTimestamp'].includes(legacyColumn.columnType);
        expect(column.type).toBe(integer ? 'INTEGER' : 'TEXT');
      }
    }
    expect(count).toBe(681);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('independently catalogs CREATE/ADD inventory through 0020 plus safe 0021', () => {
    // Inventory only. This does not transpile or execute PostgreSQL SQL.
    const directory = new URL('../drizzle/', import.meta.url);
    const inventory = new Map<string, Set<string>>();
    const tablePattern = '(?:"public"\\.)?"([^"]+)"';
    for (const file of readdirSync(directory).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
      const text = readFileSync(new URL(file, directory), 'utf8');
      for (const match of text.matchAll(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${tablePattern} \\(([\\s\\S]*?)\\n\\);`, 'g'))) {
        inventory.set(match[1], new Set([...match[2].matchAll(/^\s*"([^"]+)"\s+[^,]+/gm)].map((c) => c[1])));
      }
      for (const match of text.matchAll(new RegExp(`ALTER TABLE ${tablePattern}([\\s\\S]*?);`, 'g'))) {
        for (const column of match[2].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?"([^"]+)"/g)) {
          const fields = inventory.get(match[1]);
          expect(fields, `${file}: ${match[1]}`).toBeDefined();
          fields!.add(column[1]);
        }
      }
      if (file.startsWith('0020')) expect(inventory.size).toBe(52);
    }
    expect(inventory.size).toBe(54);
    for (const [, table] of tables) {
      const config = pgConfig(table);
      expect([...inventory.get(config.name)!].sort(), config.name).toEqual(config.columns.map((c) => c.name).sort());
    }
  });

  it('preserves all legacy foreign keys, indexes, unique keys and primary keys', () => {
    const sqlite = database();
    for (const [name, source] of tables) {
      const target = d1Tables.find(([key]) => key === name)![1];
      const old = pgConfig(source);
      const current = getTableConfig(target);
      const foreignKeys = sqlite.prepare(`PRAGMA foreign_key_list(${identifier(old.name)})`).all();
      for (const key of old.foreignKeys) {
        const reference = key.reference();
        reference.columns.forEach((column, position) => {
          expect(foreignKeys).toContainEqual(expect.objectContaining({
            from: column.name, to: reference.foreignColumns[position].name,
            table: pgConfig(reference.foreignTable).name,
            on_delete: (key.onDelete ?? 'no action').toUpperCase(),
            on_update: (key.onUpdate ?? 'no action').toUpperCase(),
          }));
        });
      }
      expect(foreignKeys.length).toBe(old.foreignKeys.reduce((sum, k) => sum + k.reference().columns.length, 0));
      const indexes = sqlite.prepare(`PRAGMA index_list(${identifier(old.name)})`).all();
      const oldNames = [
        ...old.indexes.map((i) => i.config.name),
        ...old.uniqueConstraints.map((u) => u.getName()),
        ...old.columns.filter((c) => c.isUnique).map((c) => c.uniqueName),
      ];
      for (const key of oldNames) expect(indexes.map((i) => i.name), old.name).toContain(key);
      for (const index of current.indexes) {
        const physical = indexes.find((i) => i.name === index.config.name)!;
        expect(physical.unique).toBe(index.config.unique ? 1 : 0);
        expect(physical.partial).toBe(index.config.where ? 1 : 0);
        expect(sqlite.prepare(`PRAGMA index_info(${identifier(index.config.name!)})`).all().map((r) => r.name))
          .toEqual(index.config.columns.map((c) => is(c, SQL) ? null : c.name));
      }
      const physicalPk = sqlite.prepare(`PRAGMA table_info(${identifier(old.name)})`).all().filter((r) => Number(r.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((r) => r.name);
      expect(physicalPk).toEqual(old.primaryKeys.length ? old.primaryKeys[0].columns.map((c) => c.name) : old.columns.filter((c) => c.primary).map((c) => c.name));
      for (const check of old.checks) expect(migration).toContain(check.name);
    }
    expect(migration).toContain('official_document_sin_hash_idx');
    expect(migration).toContain('deadline_rule_weekday_iso');
    expect(migration).toContain('deadline_rule_time_of_day_hhmm');
  });

  it('preserves every scalar default and independently inventories migration indexes/checks', () => {
    const sqlite = database();
    const physicalIndexes = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").all().map((row) => row.name);
    const directory = new URL('../drizzle/', import.meta.url);
    for (const file of readdirSync(directory).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
      const text = readFileSync(new URL(file, directory), 'utf8');
      for (const index of text.matchAll(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)"/g)) {
        expect(physicalIndexes, `${file}: ${index[1]}`).toContain(index[1]);
      }
      for (const check of text.matchAll(/(?:ADD )?CONSTRAINT "([^"]+)"\s+CHECK/g)) {
        expect(migration, `${file}: ${check[1]}`).toContain(check[1]);
      }
    }
    for (const [, table] of tables) {
      const config = pgConfig(table);
      const physicalColumns = sqlite.prepare(`PRAGMA table_info(${identifier(config.name)})`).all();
      for (const column of config.columns) {
        const physical = physicalColumns.find((field) => field.name === column.name)!;
        if (column.default === undefined) expect(physical.dflt_value).toBeNull();
        else if (!is(column.default, SQL)) {
          const actual = sqlite.prepare(`SELECT ${physical.dflt_value} AS value`).get()!.value;
          expect(actual, `${config.name}.${column.name}`).toBe(
            typeof column.default === 'boolean' ? Number(column.default) : column.default,
          );
        } else if (column.columnType === 'PgUUID') expect(physical.dflt_value).toContain('randomblob');
        else if (column.columnType === 'PgTimestamp') expect(physical.dflt_value).toContain('strftime');
        else throw new Error(`Unvalidated expression default ${config.name}.${column.name}`);
      }
    }
    expect(sqlite.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
  });

  it('generates valid SQLite UUIDs and database-clock millisecond defaults', () => {
    const sqlite = database();
    // Date.now and SQLite use different Windows clock APIs/precision. Compare
    // with the DB clock, not a widened host-clock tolerance. SQLite freezes
    // 'now' within a statement; unixepoch independently checks the strftime default.
    const clock = () => Number(sqlite.prepare("SELECT cast(unixepoch('subsec') * 1000 AS integer) AS ms").get()!.ms);
    const before = clock();
    const row = sqlite.prepare("INSERT INTO club(name) VALUES ('local test') RETURNING id, active, created_at, cast(unixepoch('subsec') * 1000 AS integer) AS db_clock").get()!;
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row.active).toBe(1);
    expect(Number.isSafeInteger(row.created_at)).toBe(true);
    expect(row.created_at).toBe(row.db_clock);
    expect(Number(row.created_at)).toBeGreaterThanOrEqual(before);
    expect(Number(row.created_at)).toBeLessThanOrEqual(clock());
    const ids = new Set<string>();
    for (const [, table] of tables) {
      for (const column of sqlite.prepare(`PRAGMA table_info(${identifier(pgConfig(table).name)})`).all()) {
        if (typeof column.dflt_value !== 'string' || !column.dflt_value.includes('randomblob')) continue;
        for (let i = 0; i < 10; i++) {
          const id = sqlite.prepare(`SELECT ${column.dflt_value} AS id`).get()!.id as string;
          expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          expect(ids.has(id)).toBe(false);
          ids.add(id);
        }
      }
    }
    expect(ids.size).toBeGreaterThan(400);
    expect(migration).not.toMatch(/\b(now\(\)|gen_random_uuid|jsonb|timestamptz|CREATE TYPE|CREATE FUNCTION|CREATE TRIGGER)\b/);
  });

  it('enforces enum, boolean, integer, JSON, migration-only and lease checks', () => {
    const sqlite = database();
    const season = sqlite.prepare("INSERT INTO season(label,start_date,end_date) VALUES ('test','2026-09-01','2027-08-31') RETURNING id").get()!.id;
    const rule = sqlite.prepare("INSERT INTO deadline_rule(season_id,scope,type,label,days_before,time_of_day) VALUES (?,'NACIONAL','L1','test',1,?)");
    for (const time of ['24:00', '29:15', '9:00', '23:60', '12:34x']) expect(() => rule.run(season, time)).toThrow();
    for (const time of ['00:00', '09:30', '23:59']) expect(() => rule.run(season, time)).not.toThrow();
    expect(() => sqlite.prepare("UPDATE deadline_rule SET weekday = 8").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO club(name,active) VALUES ('bad',2)").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO user_profile(email,full_name,role,ical_token) VALUES ('local','local','invalid','local')").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO sport_incremental_task(key,season,kind,payload) VALUES ('test','2027','fie_index','broken')").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO sport_incremental_task(key,season,kind,payload,attempts) VALUES ('test','2027','fie_index','{}',0.5)").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO sport_write_lease(key,owner,expires_at) VALUES ('other','unchanged-id',0)").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO sport_person(id,display_name,name_normalized,merged_into_person_id) VALUES ('x','x','x','x')").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO sport_person(display_name,name_normalized,birth_year) VALUES ('x','x',40000)").run()).toThrow();
  });

  it('retains nullable unique behavior and real FK cascade/set-null actions', () => {
    const sqlite = database();
    const clubId = sqlite.prepare("INSERT INTO club(id,name) VALUES ('exact-id','test') RETURNING id").get()!.id;
    sqlite.prepare("INSERT INTO user_profile(id,email,full_name,ical_token,club_id) VALUES ('profile','local','local','local',?)").run(clubId);
    sqlite.prepare("INSERT INTO athlete(id,first_name,last_name,birth_date,gender,club_id,user_profile_id) VALUES ('a','local','local','2001-01-01','M',?,'profile'), ('b','local','local','2001-01-01','M',?,'profile')").run(clubId, clubId);
    sqlite.prepare("INSERT INTO athlete_weapon(athlete_id,weapon) VALUES ('a','ESPADA')").run();
    expect(() => sqlite.prepare("INSERT INTO athlete_weapon(athlete_id,weapon) VALUES ('missing','ESPADA')").run()).toThrow();
    sqlite.prepare("DELETE FROM club WHERE id = ?").run(clubId);
    expect(sqlite.prepare("SELECT club_id FROM user_profile WHERE id = 'profile'").get()!.club_id).toBeNull();
    sqlite.prepare("DELETE FROM athlete WHERE id = 'a'").run();
    expect(sqlite.prepare("SELECT * FROM athlete_weapon").all()).toEqual([]);
  });
});
