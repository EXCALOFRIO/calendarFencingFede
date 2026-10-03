import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { CAPACITY_DEFINITIONS, CAPACITY_COLUMNS, rowChargeDefinition } from './capacity';

export const FENCED_TABLES = [
  'sport_person', 'sport_person_alias', 'sport_external_id', 'sport_link_candidate',
  'sport_edition', 'sport_competition', 'sport_result', 'sport_bout',
  'sport_ranking_publication', 'sport_ranking_entry', 'sport_import_coverage', 'sport_incremental_task',
] as const;

const normalize = (s: string) => (s.trim().replace(/;$/, '')
  .match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|[A-Za-z_0-9]+|[^\s]/g) ?? []).join(' ');
// Check the COMPLETE security expressions, not substrings that an OR 1=1
// could satisfy. Keep these synchronized with the owned migration SQL0002.
const SECURITY_DEFINITIONS = CAPACITY_DEFINITIONS;

/** Do not silently continue with a partial schema, disabled/changed guards or leaked context. */
export async function verificarEsquemaD1(db: Db) {
  const { rows } = await db.execute(sql`select name,sql from sqlite_master
    where type in ('table','trigger','view') and name like 'sport_%'`);
  const definitions = new Map(rows.map((r) => [String(r.name), String(r.sql)]));
  for (const [name, expected] of Object.entries(SECURITY_DEFINITIONS)) {
    if (normalize(definitions.get(name) ?? '') !== normalize(expected)) throw new Error('sport_migration_required');
  }
  if (!FENCED_TABLES.every((t) => definitions.has(t)) ||
    !definitions.has('sport_write_context') || !definitions.has('sport_write_lease')) {
    throw new Error('sport_migration_required');
  }
  for (const table of FENCED_TABLES) for (const action of ['insert', 'update', 'delete']) {
    const definition = definitions.get(`sport_fence_${table}_${action}`);
    const expected = `CREATE TRIGGER sport_fence_${table}_${action} BEFORE ${action.toUpperCase()} ON ${table} BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) THEN RAISE(ABORT, 'sport_write_lease_required') END; END`;
    if (normalize(definition ?? '') !== normalize(expected)) throw new Error('sport_migration_required');
    if (normalize(definitions.get(`sport_charge_${table}_${action}`) ?? '') !==
      normalize(rowChargeDefinition(table, action))) throw new Error('sport_migration_required');
  }
  // One bounded read-only batch avoids sequential remote metadata roundtrips.
  // A future added column must not evade row byte accounting.
  const info = FENCED_TABLES.map((table) => db.execute(sql.raw(`pragma table_info('${table}')`)));
  const [first, ...rest] = [...info,
    db.execute(sql`pragma table_info('sport_write_lease')`),
    db.execute(sql`pragma foreign_keys`),
    db.execute(sql`select count(*) as n from sport_write_context`),
    db.execute(sql`select count(*) as n from sport_write_charge`),
    db.execute(sql`select key,accounted_bytes,blocked from sport_capacity_ledger`),
  ];
  const checks = await db.batch([first, ...rest]);
  for (const [i, table] of FENCED_TABLES.entries()) {
    const columns = checks[i].rows;
    if (JSON.stringify(columns.map((r) => r.name)) !== JSON.stringify(CAPACITY_COLUMNS[table])) {
      throw new Error('sport_migration_required');
    }
  }
  const publication = checks[FENCED_TABLES.indexOf('sport_ranking_publication')].rows;
  const [lease, fk, context, charge, ledger] = checks.slice(FENCED_TABLES.length).map((r) => r.rows);
  if (!['date_basis', 'revision'].every((n) => publication.some((r) => r.name === n)) ||
    !lease.some((r) => r.name === 'lease_version' && r.type === 'INTEGER' && r.notnull === 1) ||
    !definitions.get('sport_competition')?.includes("'M10'") ||
    !definitions.get('sport_competition')?.includes("'M12'") ||
    !definitions.has('sport_registration_ref')) throw new Error('sport_migration_required');
  if (Number(fk[0]?.foreign_keys) !== 1 || Number(context[0]?.n) !== 0 || Number(charge[0]?.n) !== 0 ||
    ledger.length !== 1 || ledger[0].key !== 'global' ||
    !Number.isSafeInteger(ledger[0].accounted_bytes) || Number(ledger[0].accounted_bytes) < 0 ||
    ![0, 1].includes(Number(ledger[0].blocked))) throw new Error('sport_migration_required');
  if (Number(ledger[0].blocked) !== 0) throw new Error('sport_capacity');
  return { identidad: true, referencias: true };
}
