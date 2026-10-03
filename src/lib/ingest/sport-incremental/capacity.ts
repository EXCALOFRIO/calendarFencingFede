import { assertD1Parameters } from '@/db/d1/binding';

/** Deliberately pessimistic accounting units, NOT a physical SQLite size theorem. */
export const CAPACITY_ROW_OVERHEAD = 1_024;
export const CAPACITY_PAYLOAD_FACTOR = 4;
export const CAPACITY_BATCH_OVERHEAD = 16_384;
const encoder = new TextEncoder();

export function reservaCapacidad(queries: readonly { sql: string; params: unknown[] }[]): number {
  let bytes = CAPACITY_BATCH_OVERHEAD;
  for (const query of queries) {
    assertD1Parameters(query.params);
    let payload = encoder.encode(query.sql).byteLength;
    for (const value of query.params) {
      if (value instanceof ArrayBuffer) payload += value.byteLength * 4 + 2;
      else if (ArrayBuffer.isView(value)) payload += value.byteLength * 4 + 2;
      else payload += encoder.encode(JSON.stringify(value)).byteLength;
    }
    bytes += CAPACITY_ROW_OVERHEAD * (query.params.length + 1) + CAPACITY_PAYLOAD_FACTOR * payload;
  }
  bytes = Math.ceil(bytes / 4096) * 4096;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('sport_capacity_projection_unknown');
  return bytes;
}

// Complete definitions are shared with the strict schema verifier. SQL0002
// contains these literal definitions and generated row charges; tests compare
// SQLite's actual sqlite_master definitions, not only the object names.
export const CAPACITY_DEFINITIONS = {
  sport_capacity_ledger: `CREATE TABLE sport_capacity_ledger (
    key TEXT PRIMARY KEY CHECK (key = 'global'),
    accounted_bytes INTEGER NOT NULL CHECK (typeof(accounted_bytes)='integer' AND accounted_bytes>=0),
    blocked INTEGER NOT NULL CHECK (blocked IN (0,1)))`,
  sport_write_context: `CREATE TABLE sport_write_context (
    key TEXT PRIMARY KEY CHECK (key = 'global'), owner TEXT NOT NULL,
    lease_version INTEGER NOT NULL CHECK (lease_version > 0),
    budget_bytes INTEGER NOT NULL CHECK (
      typeof(budget_bytes)='integer' AND budget_bytes>0 AND budget_bytes<=4294967296),
    projected_bytes INTEGER NOT NULL CHECK (
      typeof(projected_bytes)='integer' AND projected_bytes>=${CAPACITY_BATCH_OVERHEAD}),
    measured_bytes INTEGER NOT NULL CHECK (
      typeof(measured_bytes)='integer' AND measured_bytes>0))`,
  sport_write_charge: `CREATE TABLE sport_write_charge (
    key TEXT PRIMARY KEY CHECK (key = 'global'),
    remaining_bytes INTEGER NOT NULL CHECK (
      typeof(remaining_bytes)='integer' AND remaining_bytes>=0))`,
  sport_write_authorized: `CREATE VIEW sport_write_authorized AS
    SELECT 1 AS ok FROM sport_write_context c JOIN sport_write_lease l
      ON l.key=c.key AND l.owner=c.owner AND l.lease_version=c.lease_version
    JOIN sport_capacity_ledger b ON b.key=c.key
    WHERE l.key='global' AND l.expires_at >
      (cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))
      AND b.blocked=0 AND b.accounted_bytes<c.budget_bytes`,
  sport_context_claim: `CREATE TRIGGER sport_context_claim BEFORE INSERT ON sport_write_context BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM sport_write_context)
      OR EXISTS (SELECT 1 FROM sport_write_charge) OR NOT EXISTS (
        SELECT 1 FROM sport_write_lease l WHERE l.key=NEW.key AND l.owner=NEW.owner
          AND l.lease_version=NEW.lease_version AND l.expires_at >
          (cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))
      ) THEN RAISE(ABORT, 'sport_write_lease_required') END;
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM sport_capacity_ledger b WHERE b.key=NEW.key AND b.blocked=0
        AND max(b.accounted_bytes,NEW.measured_bytes)+NEW.projected_bytes<NEW.budget_bytes
      ) THEN RAISE(ABORT, 'sport_capacity') END;
    END`,
  sport_context_reserve: `CREATE TRIGGER sport_context_reserve AFTER INSERT ON sport_write_context BEGIN
    INSERT INTO sport_write_charge(key,remaining_bytes)
      VALUES(NEW.key,NEW.projected_bytes-${CAPACITY_BATCH_OVERHEAD});
    UPDATE sport_capacity_ledger
      SET accounted_bytes=max(accounted_bytes,NEW.measured_bytes)+${CAPACITY_BATCH_OVERHEAD} WHERE key=NEW.key;
    END`,
  sport_context_close: `CREATE TRIGGER sport_context_close BEFORE DELETE ON sport_write_context BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized)
      OR NOT EXISTS (SELECT 1 FROM sport_write_charge WHERE key=OLD.key)
      THEN RAISE(ABORT, 'sport_write_lease_or_capacity_lost') END;
    DELETE FROM sport_write_charge WHERE key=OLD.key;
    END`,
  sport_context_immutable: `CREATE TRIGGER sport_context_immutable BEFORE UPDATE ON sport_write_context BEGIN
    SELECT RAISE(ABORT, 'sport_write_context_immutable'); END`,
  sport_charge_claim: `CREATE TRIGGER sport_charge_claim BEFORE INSERT ON sport_write_charge BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized)
      OR NOT EXISTS (SELECT 1 FROM sport_write_context
        WHERE key=NEW.key AND projected_bytes-${CAPACITY_BATCH_OVERHEAD}=NEW.remaining_bytes)
      THEN RAISE(ABORT, 'sport_capacity') END; END`,
  sport_charge_update: `CREATE TRIGGER sport_charge_update BEFORE UPDATE ON sport_write_charge BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized)
      OR NEW.key<>OLD.key OR NEW.remaining_bytes>OLD.remaining_bytes
      THEN RAISE(ABORT, 'sport_capacity') END; END`,
  sport_charge_delete: `CREATE TRIGGER sport_charge_delete BEFORE DELETE ON sport_write_charge BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized)
      THEN RAISE(ABORT, 'sport_capacity') END; END`,
  sport_ledger_insert: `CREATE TRIGGER sport_ledger_insert BEFORE INSERT ON sport_capacity_ledger BEGIN
    SELECT RAISE(ABORT, 'sport_capacity_ledger_immutable'); END`,
  sport_ledger_delete: `CREATE TRIGGER sport_ledger_delete BEFORE DELETE ON sport_capacity_ledger BEGIN
    SELECT RAISE(ABORT, 'sport_capacity_ledger_immutable'); END`,
  sport_ledger_update: `CREATE TRIGGER sport_ledger_update BEFORE UPDATE ON sport_capacity_ledger BEGIN
    SELECT CASE WHEN NEW.key<>OLD.key OR NEW.accounted_bytes<OLD.accounted_bytes OR NEW.blocked<OLD.blocked
      OR (NOT EXISTS (SELECT 1 FROM sport_write_authorized) AND NOT (
        NEW.blocked=1 AND NEW.accounted_bytes=OLD.accounted_bytes))
      THEN RAISE(ABORT, 'sport_capacity_ledger_immutable') END; END`,
};

// Filled from the verified native schema; changes require synchronized SQL0002.
export const CAPACITY_COLUMNS: Record<string, readonly string[]> = {
  "sport_person": [
    "id",
    "athlete_id",
    "athlete_linked_via",
    "athlete_linked_at",
    "athlete_link_evidence",
    "display_name",
    "first_name",
    "last_name",
    "name_normalized",
    "gender",
    "country_code",
    "birth_year",
    "merged_into_person_id",
    "created_at",
    "updated_at"
  ],
  "sport_person_alias": [
    "id",
    "person_id",
    "source",
    "name_original",
    "name_normalized",
    "first_seen_at"
  ],
  "sport_external_id": [
    "id",
    "person_id",
    "scheme",
    "value",
    "scope_source",
    "scope_federation",
    "scope_season",
    "scope_weapon",
    "valid_from",
    "valid_to",
    "link_status",
    "linked_via",
    "linked_at",
    "evidence",
    "decided_by_profile_id",
    "created_at",
    "updated_at"
  ],
  "sport_link_candidate": [
    "id",
    "source",
    "source_ref",
    "source_name",
    "person_id",
    "status",
    "evidence",
    "decided_by_profile_id",
    "decided_at",
    "created_at"
  ],
  "sport_edition": [
    "id",
    "source",
    "season",
    "tournament_key",
    "name",
    "start_date",
    "end_date",
    "city",
    "country_code",
    "source_url",
    "event_id",
    "updated_at"
  ],
  "sport_competition": [
    "id",
    "edition_id",
    "source",
    "season",
    "competition_key",
    "weapon",
    "gender",
    "category",
    "category_raw",
    "format",
    "competition_date",
    "source_url",
    "event_competition_id",
    "updated_at"
  ],
  "sport_result": [
    "id",
    "competition_id",
    "source",
    "source_fact_key",
    "person_id",
    "source_name",
    "source_country_code",
    "source_club",
    "position",
    "position_raw",
    "official_points",
    "occurred_on",
    "source_url",
    "content_hash",
    "revision",
    "first_seen_at",
    "revised_at"
  ],
  "sport_bout": [
    "id",
    "competition_id",
    "source",
    "phase",
    "round_key",
    "fencer_a_ref",
    "fencer_b_ref",
    "fencer_a_person_id",
    "fencer_b_person_id",
    "fencer_a_name",
    "fencer_b_name",
    "score_a",
    "score_b",
    "occurred_on",
    "source_url",
    "content_hash",
    "revision",
    "first_seen_at",
    "revised_at"
  ],
  "sport_ranking_publication": [
    "id",
    "source",
    "season",
    "weapon",
    "gender",
    "category",
    "category_raw",
    "format",
    "published_on",
    "date_basis",
    "revision",
    "source_url",
    "published_total",
    "fetched_at"
  ],
  "sport_ranking_entry": [
    "id",
    "publication_id",
    "source_ref",
    "person_id",
    "source_name",
    "country_code",
    "position",
    "points"
  ],
  "sport_import_coverage": [
    "id",
    "source",
    "season",
    "fact_kind",
    "competition_key",
    "competition_id",
    "status",
    "published_total",
    "imported_total",
    "cursor",
    "attempts",
    "source_url",
    "last_checked_at",
    "last_error",
    "updated_at"
  ],
  "sport_incremental_task": [
    "key",
    "season",
    "kind",
    "payload",
    "next_check_at",
    "last_checked_at",
    "status",
    "attempts"
  ]
};

export function rowChargeDefinition(table: string, action: string): string {
  const columns = CAPACITY_COLUMNS[table];
  if (!columns?.length || !['insert', 'update', 'delete'].includes(action)) throw new Error('sport_capacity_schema_missing');
  // A bounded UPDATE can retain a large cursor that was already charged on
  // insertion. Charge the full NEW bytes of changed columns, not retained
  // bytes or only positive growth. SQL-generated payloads still exhaust the
  // reservation, and every touched row pays the overhead (including no-ops).
  const payload = columns.map((c) => {
    const bytes = `coalesce(length(CAST(NEW."${c}" AS BLOB)),0)`;
    return action === 'update' ? `CASE WHEN NEW."${c}" IS OLD."${c}" THEN 0 ELSE ${bytes} END` : bytes;
  }).join('+');
  const cost = action === 'delete' ? String(CAPACITY_ROW_OVERHEAD)
    : `${CAPACITY_ROW_OVERHEAD}+${CAPACITY_PAYLOAD_FACTOR}*(${payload})`;
  return `CREATE TRIGGER sport_charge_${table}_${action} AFTER ${action.toUpperCase()} ON ${table} BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) OR NOT EXISTS (
      SELECT 1 FROM sport_write_charge WHERE key='global' AND remaining_bytes>=${cost}
    ) THEN RAISE(ABORT, 'sport_capacity_reservation_exhausted') END;
    UPDATE sport_write_charge SET remaining_bytes=remaining_bytes-(${cost}) WHERE key='global';
    UPDATE sport_capacity_ledger SET accounted_bytes=accounted_bytes+(${cost}) WHERE key='global';
    END`;
}
