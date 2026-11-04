-- Read-only checks for 0022_indice_evento_fin.sql (run after applying):
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --json --env-file NUL --file drizzle-d1/manual/0022_indice_evento_fin.comprobar.sql
-- Expected: puesto = 1 and both plans say SEARCH event USING INDEX
-- event_fin_vigente_idx (never SCAN event).
SELECT count(*) AS puesto FROM sqlite_master
  WHERE type='index' AND name='event_fin_vigente_idx';

-- The hot path of listEvents (portada and past tranches): visible events in
-- an end_date range, ordered by start_date.
EXPLAIN QUERY PLAN SELECT id FROM event
  WHERE disappeared_at IS NULL AND canonical_event_id IS NULL
    AND end_date >= '2025-09-01' AND end_date < '2025-10-01'
  ORDER BY start_date, name
  LIMIT 400;

-- The footer counter (contarPruebas): same WHERE, no order.
EXPLAIN QUERY PLAN SELECT count(*) FROM event
  WHERE disappeared_at IS NULL AND canonical_event_id IS NULL
    AND end_date >= '2025-10-01';
