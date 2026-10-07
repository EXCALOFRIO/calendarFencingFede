-- Inverse of 0019_recalibrar_libro.sql: puts the ledger back to the value it had before
-- (6,450,944,980 B when 0019 was written; replace it with the value noted by
-- 0019_recalibrar_libro.comprobar.sql just before applying 0019).
-- Never lowers: max(current, previous); a ledger that has already grown past the old value is
-- left as it is. Same conditions as 0019: no open write context or
-- charge and no live lease. Time Travel to the bookmark taken before 0019 is the alternative,
-- but it also discards every write made since then.
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/manual/0019_recalibrar_libro.deshacer.sql
CREATE TABLE _guardia_0019_deshacer (
  abiertos INTEGER NOT NULL CHECK (abiertos=0),
  leases INTEGER NOT NULL CHECK (leases=0),
  libro INTEGER NOT NULL);
INSERT INTO _guardia_0019_deshacer(abiertos,leases,libro) SELECT
  (SELECT count(*) FROM sport_write_context)+(SELECT count(*) FROM sport_write_charge),
  (SELECT count(*) FROM sport_write_lease WHERE expires_at >
    (cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))),
  (SELECT accounted_bytes FROM sport_capacity_ledger WHERE key='global');
DROP TABLE _guardia_0019_deshacer;
DROP TRIGGER sport_ledger_update;
UPDATE sport_capacity_ledger SET accounted_bytes=max(accounted_bytes, 6450944980) WHERE key='global';
CREATE TRIGGER sport_ledger_update BEFORE UPDATE ON sport_capacity_ledger BEGIN
    SELECT CASE WHEN NEW.key<>OLD.key OR NEW.accounted_bytes<OLD.accounted_bytes OR NEW.blocked<OLD.blocked
      OR (NOT EXISTS (SELECT 1 FROM sport_write_authorized) AND NOT (
        NEW.blocked=1 AND NEW.accounted_bytes=OLD.accounted_bytes))
      THEN RAISE(ABORT, 'sport_capacity_ledger_immutable') END; END;
