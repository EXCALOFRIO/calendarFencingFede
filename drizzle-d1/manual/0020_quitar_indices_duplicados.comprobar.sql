-- Read-only checks for 0020_quitar_indices_duplicados.sql (run after applying):
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --json --env-file NUL --file drizzle-d1/manual/0020_quitar_indices_duplicados.comprobar.sql
-- Expected: quedan = 0, and every plan says SEARCH ... USING [COVERING] INDEX sport_bout_key or
-- sport_external_id_person_key, never SCAN sport_bout / SCAN sport_external_id.
SELECT count(*) AS quedan FROM sqlite_master
  WHERE type='index' AND name IN ('sport_bout_competition_idx','sport_external_id_person_idx');
EXPLAIN QUERY PLAN SELECT count(*) FROM sport_bout b WHERE b.competition_id = 'x';
EXPLAIN QUERY PLAN SELECT b.competition_id, b.phase, count(*) FROM sport_bout b
  WHERE b.competition_id IN ('x','y') GROUP BY b.competition_id, b.phase;
EXPLAIN QUERY PLAN SELECT count(*) FROM sport_bout WHERE competition_id='x' AND source='fie' AND phase='POULE';
EXPLAIN QUERY PLAN SELECT DISTINCT value FROM sport_external_id WHERE person_id IN ('x','y');
