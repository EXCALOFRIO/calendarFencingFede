-- Inverse of drizzle-d1/0022_indice_evento_fin.sql. The index only speeds up
-- reads; dropping it returns the previous plan without touching any row.
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/manual/0022_indice_evento_fin.deshacer.sql
DROP INDEX IF EXISTS event_fin_vigente_idx;
