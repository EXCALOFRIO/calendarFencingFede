-- Drops two non-unique indexes that are a strict prefix of a unique index on the same table:
--   sport_bout_competition_idx (competition_id, phase, round_key)
--     -> sport_bout_key (competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref)
--   sport_external_id_person_idx (person_id)
--     -> sport_external_id_person_key (person_id, scheme, value, ...)
-- Every query and foreign-key lookup that filtered by the leading column keeps an index search
-- (EXPLAIN QUERY PLAN on a copy of production: docs/guia-administracion.md section 5). Frees
-- ~101 MB (24,720 pages of 4 KiB) for reuse. DDL only: no sport_* trigger fires and the
-- capacity ledger does not move; verificarEsquemaD1 does not check indexes.
-- The baseline 0000_aplicacion.sql still creates both; this migration removes them afterwards.
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/0020_quitar_indices_duplicados.sql
-- Inverse: drizzle-d1/manual/0020_quitar_indices_duplicados.deshacer.sql.
DROP INDEX IF EXISTS sport_bout_competition_idx;
DROP INDEX IF EXISTS sport_external_id_person_idx;
