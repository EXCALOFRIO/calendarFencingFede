-- Recalibrates sport_capacity_ledger.accounted_bytes DOWN to a measured size plus margin.
-- The ledger is a pessimistic write counter (charges every INSERT/UPDATE/DELETE, never refunds),
-- not an occupancy measure: in October 2026 it read 6,450,944,980 B against ~2.10 GB of real D1.
-- Rules: docs/guia-administracion.md section 5. Inverse and checks: drizzle-d1/manual/0019_*.sql.
--
-- The three literals of _parametros_0019 MUST be recomputed right before applying:
--   node node_modules/tsx/dist/cli.mjs scripts/indexado/recalibrar-libro.ts --medido <bytes> --escribir
-- where <bytes> is meta.size_after of a read-only remote query (or database_size of
-- `wrangler d1 info --json`). The committed valido_hasta_ms is 0, so this file aborts in
-- production until it is filled in. The guard only applies when the ledger would actually go
-- down: on a fresh or already recalibrated database the file changes nothing except dropping
-- and recreating sport_ledger_update with identical text.
--
-- Never below the measured size: libro_bytes >= medido_bytes * 1.1 (CHECK). Never upwards: the
-- UPDATE only lowers. Aborts (and the import rolls back) with an open write context or charge,
-- a live sport_write_lease, a blocked ledger, or an expired measurement. The recreated
-- sport_ledger_update is the exact text of CAPACITY_DEFINITIONS
-- (src/lib/ingest/sport-incremental/capacity.ts); verificarEsquemaD1 compares it.
CREATE TABLE _parametros_0019 (
  medido_bytes INTEGER NOT NULL CHECK (typeof(medido_bytes)='integer' AND medido_bytes>0),
  libro_bytes INTEGER NOT NULL,
  valido_hasta_ms INTEGER NOT NULL CHECK (typeof(valido_hasta_ms)='integer'),
  CONSTRAINT recalibrado_margen_minimo CHECK (
    typeof(libro_bytes)='integer' AND libro_bytes>=medido_bytes+medido_bytes/10),
  CONSTRAINT recalibrado_por_debajo_de_la_parada CHECK (libro_bytes<=8589934592-536870912));
INSERT INTO _parametros_0019(medido_bytes,libro_bytes,valido_hasta_ms) VALUES (
  2210582528, -- medido_bytes
  2550136832, -- libro_bytes
  1791401475130); -- valido_hasta_ms
CREATE TABLE _guardia_0019 (
  aplica INTEGER NOT NULL,
  abiertos INTEGER NOT NULL,
  leases INTEGER NOT NULL,
  bloqueado INTEGER NOT NULL,
  ahora INTEGER NOT NULL,
  valido_hasta INTEGER NOT NULL,
  CONSTRAINT recalibrado_contexto_abierto CHECK (aplica=0 OR abiertos=0),
  CONSTRAINT recalibrado_lease_vigente CHECK (aplica=0 OR leases=0),
  CONSTRAINT recalibrado_libro_bloqueado CHECK (aplica=0 OR bloqueado=0),
  CONSTRAINT recalibrado_medida_caducada CHECK (aplica=0 OR ahora<=valido_hasta));
-- A missing ledger row leaves aplica NULL and fails NOT NULL.
INSERT INTO _guardia_0019(aplica,abiertos,leases,bloqueado,ahora,valido_hasta)
  SELECT l.accounted_bytes>p.libro_bytes,
    (SELECT count(*) FROM sport_write_context)+(SELECT count(*) FROM sport_write_charge),
    (SELECT count(*) FROM sport_write_lease WHERE expires_at >
      (cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))),
    l.blocked,
    (cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer)),
    p.valido_hasta_ms
  FROM _parametros_0019 p LEFT JOIN sport_capacity_ledger l ON l.key='global';
DROP TRIGGER sport_ledger_update;
UPDATE sport_capacity_ledger SET accounted_bytes=(SELECT libro_bytes FROM _parametros_0019)
  WHERE key='global' AND accounted_bytes>(SELECT libro_bytes FROM _parametros_0019);
CREATE TRIGGER sport_ledger_update BEFORE UPDATE ON sport_capacity_ledger BEGIN
    SELECT CASE WHEN NEW.key<>OLD.key OR NEW.accounted_bytes<OLD.accounted_bytes OR NEW.blocked<OLD.blocked
      OR (NOT EXISTS (SELECT 1 FROM sport_write_authorized) AND NOT (
        NEW.blocked=1 AND NEW.accounted_bytes=OLD.accounted_bytes))
      THEN RAISE(ABORT, 'sport_capacity_ledger_immutable') END; END;
DROP TABLE _guardia_0019;
DROP TABLE _parametros_0019;
