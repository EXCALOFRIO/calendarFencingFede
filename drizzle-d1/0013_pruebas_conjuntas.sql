-- Combined competitions (pruebas conjuntas): one Engarde reading (pools + tableau) of an
-- event that the RFEE PDF / Skermo publish split into several classifications (veterans age
-- bands fenced together, Criterium mixed-gender or two birth years together).
-- Built offline by scripts/indexado/dedupe-conjuntas.ts and copied by sincronizar-d1.
-- Additive only: a new table that the deployed code never reads. Apply BEFORE syncing a
-- working copy that has rows in it, and apply it to the local base.sqlite too so it stays an
-- exact copy of production.
--
-- One row per split competition (part_competition_id is unique): the split keeps the official
-- placings; the combined competition keeps its pools and tableau, and its own placings stay
-- unlinked from any person (sport_result.person_id IS NULL), so a profile never shows the same
-- result twice. The app links a split to «Poules y cuadro: prueba conjunta»
-- (src/lib/sport/explorar/pruebas-conjuntas.ts).
--
-- rule: 'partes' (two or more disjoint classifications inside the combined one) or
-- 'contenida' (one classification inside a larger reading that the duplicate merge rejects).
-- shared_names: names of the split found in the combined reading when it was detected.
-- Same write guard as the other sport_* tables (0002): lease + capacity charge per row.
CREATE TABLE sport_competition_combined (
  id TEXT PRIMARY KEY NOT NULL,
  part_competition_id TEXT NOT NULL REFERENCES sport_competition(id) ON DELETE CASCADE,
  combined_competition_id TEXT NOT NULL REFERENCES sport_competition(id) ON DELETE CASCADE,
  rule TEXT NOT NULL CHECK (rule IN ('partes', 'contenida')),
  shared_names INTEGER NOT NULL CHECK (typeof(shared_names) = 'integer' AND shared_names >= 0),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
  CHECK (part_competition_id <> combined_competition_id)
);
CREATE UNIQUE INDEX sport_competition_combined_part_key ON sport_competition_combined (part_competition_id);
CREATE INDEX sport_competition_combined_combined_idx ON sport_competition_combined (combined_competition_id);
CREATE TRIGGER sport_fence_sport_competition_combined_insert BEFORE INSERT ON sport_competition_combined BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) THEN RAISE(ABORT, 'sport_write_lease_required') END; END;
CREATE TRIGGER sport_fence_sport_competition_combined_update BEFORE UPDATE ON sport_competition_combined BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) THEN RAISE(ABORT, 'sport_write_lease_required') END; END;
CREATE TRIGGER sport_fence_sport_competition_combined_delete BEFORE DELETE ON sport_competition_combined BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) THEN RAISE(ABORT, 'sport_write_lease_required') END; END;
CREATE TRIGGER sport_charge_sport_competition_combined_insert AFTER INSERT ON sport_competition_combined BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) OR NOT EXISTS (
      SELECT 1 FROM sport_write_charge WHERE key='global' AND remaining_bytes>=1024+4*(coalesce(length(CAST(NEW."id" AS BLOB)),0)+coalesce(length(CAST(NEW."part_competition_id" AS BLOB)),0)+coalesce(length(CAST(NEW."combined_competition_id" AS BLOB)),0)+coalesce(length(CAST(NEW."rule" AS BLOB)),0)+coalesce(length(CAST(NEW."shared_names" AS BLOB)),0)+coalesce(length(CAST(NEW."created_at" AS BLOB)),0))
    ) THEN RAISE(ABORT, 'sport_capacity_reservation_exhausted') END;
    UPDATE sport_write_charge SET remaining_bytes=remaining_bytes-(1024+4*(coalesce(length(CAST(NEW."id" AS BLOB)),0)+coalesce(length(CAST(NEW."part_competition_id" AS BLOB)),0)+coalesce(length(CAST(NEW."combined_competition_id" AS BLOB)),0)+coalesce(length(CAST(NEW."rule" AS BLOB)),0)+coalesce(length(CAST(NEW."shared_names" AS BLOB)),0)+coalesce(length(CAST(NEW."created_at" AS BLOB)),0))) WHERE key='global';
    UPDATE sport_capacity_ledger SET accounted_bytes=accounted_bytes+(1024+4*(coalesce(length(CAST(NEW."id" AS BLOB)),0)+coalesce(length(CAST(NEW."part_competition_id" AS BLOB)),0)+coalesce(length(CAST(NEW."combined_competition_id" AS BLOB)),0)+coalesce(length(CAST(NEW."rule" AS BLOB)),0)+coalesce(length(CAST(NEW."shared_names" AS BLOB)),0)+coalesce(length(CAST(NEW."created_at" AS BLOB)),0))) WHERE key='global';
    END;
CREATE TRIGGER sport_charge_sport_competition_combined_update AFTER UPDATE ON sport_competition_combined BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) OR NOT EXISTS (
      SELECT 1 FROM sport_write_charge WHERE key='global' AND remaining_bytes>=1024+4*(CASE WHEN NEW."id" IS OLD."id" THEN 0 ELSE coalesce(length(CAST(NEW."id" AS BLOB)),0) END+CASE WHEN NEW."part_competition_id" IS OLD."part_competition_id" THEN 0 ELSE coalesce(length(CAST(NEW."part_competition_id" AS BLOB)),0) END+CASE WHEN NEW."combined_competition_id" IS OLD."combined_competition_id" THEN 0 ELSE coalesce(length(CAST(NEW."combined_competition_id" AS BLOB)),0) END+CASE WHEN NEW."rule" IS OLD."rule" THEN 0 ELSE coalesce(length(CAST(NEW."rule" AS BLOB)),0) END+CASE WHEN NEW."shared_names" IS OLD."shared_names" THEN 0 ELSE coalesce(length(CAST(NEW."shared_names" AS BLOB)),0) END+CASE WHEN NEW."created_at" IS OLD."created_at" THEN 0 ELSE coalesce(length(CAST(NEW."created_at" AS BLOB)),0) END)
    ) THEN RAISE(ABORT, 'sport_capacity_reservation_exhausted') END;
    UPDATE sport_write_charge SET remaining_bytes=remaining_bytes-(1024+4*(CASE WHEN NEW."id" IS OLD."id" THEN 0 ELSE coalesce(length(CAST(NEW."id" AS BLOB)),0) END+CASE WHEN NEW."part_competition_id" IS OLD."part_competition_id" THEN 0 ELSE coalesce(length(CAST(NEW."part_competition_id" AS BLOB)),0) END+CASE WHEN NEW."combined_competition_id" IS OLD."combined_competition_id" THEN 0 ELSE coalesce(length(CAST(NEW."combined_competition_id" AS BLOB)),0) END+CASE WHEN NEW."rule" IS OLD."rule" THEN 0 ELSE coalesce(length(CAST(NEW."rule" AS BLOB)),0) END+CASE WHEN NEW."shared_names" IS OLD."shared_names" THEN 0 ELSE coalesce(length(CAST(NEW."shared_names" AS BLOB)),0) END+CASE WHEN NEW."created_at" IS OLD."created_at" THEN 0 ELSE coalesce(length(CAST(NEW."created_at" AS BLOB)),0) END)) WHERE key='global';
    UPDATE sport_capacity_ledger SET accounted_bytes=accounted_bytes+(1024+4*(CASE WHEN NEW."id" IS OLD."id" THEN 0 ELSE coalesce(length(CAST(NEW."id" AS BLOB)),0) END+CASE WHEN NEW."part_competition_id" IS OLD."part_competition_id" THEN 0 ELSE coalesce(length(CAST(NEW."part_competition_id" AS BLOB)),0) END+CASE WHEN NEW."combined_competition_id" IS OLD."combined_competition_id" THEN 0 ELSE coalesce(length(CAST(NEW."combined_competition_id" AS BLOB)),0) END+CASE WHEN NEW."rule" IS OLD."rule" THEN 0 ELSE coalesce(length(CAST(NEW."rule" AS BLOB)),0) END+CASE WHEN NEW."shared_names" IS OLD."shared_names" THEN 0 ELSE coalesce(length(CAST(NEW."shared_names" AS BLOB)),0) END+CASE WHEN NEW."created_at" IS OLD."created_at" THEN 0 ELSE coalesce(length(CAST(NEW."created_at" AS BLOB)),0) END)) WHERE key='global';
    END;
CREATE TRIGGER sport_charge_sport_competition_combined_delete AFTER DELETE ON sport_competition_combined BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) OR NOT EXISTS (
      SELECT 1 FROM sport_write_charge WHERE key='global' AND remaining_bytes>=1024
    ) THEN RAISE(ABORT, 'sport_capacity_reservation_exhausted') END;
    UPDATE sport_write_charge SET remaining_bytes=remaining_bytes-(1024) WHERE key='global';
    UPDATE sport_capacity_ledger SET accounted_bytes=accounted_bytes+(1024) WHERE key='global';
    END;
