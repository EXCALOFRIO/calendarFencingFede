-- Read-only checks for 0019_recalibrar_libro.sql. Run BEFORE (note the old ledger value) and
-- AFTER applying:
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --json --env-file NUL --file drizzle-d1/manual/0019_recalibrar_libro.comprobar.sql
-- meta.size_after of any result is the real size of the database at that moment.
-- Expected after applying: libro_bytes = the libro_bytes literal, bloqueado 0, abiertos 0,
-- lease_vigente 0 (before applying), guardas 0, triggers_ledger 3, the second result with the
-- exact text of CAPACITY_DEFINITIONS.sport_ledger_update, and libro_bytes > size_after.
SELECT
  (SELECT accounted_bytes FROM sport_capacity_ledger WHERE key='global') AS libro_bytes,
  (SELECT blocked FROM sport_capacity_ledger WHERE key='global') AS bloqueado,
  (SELECT count(*) FROM sport_write_context)+(SELECT count(*) FROM sport_write_charge) AS abiertos,
  (SELECT count(*) FROM sport_write_lease WHERE expires_at >
    (cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))) AS lease_vigente,
  (SELECT count(*) FROM sqlite_master WHERE name IN ('_parametros_0019','_guardia_0019')) AS guardas,
  (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'sport_ledger_%') AS triggers_ledger,
  (cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer)) AS ahora_ms;
SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name='sport_ledger_update';
