-- Inverse of drizzle-d1/0021_explorar_selecciones.sql. Run it only with a version 1 deployment
-- (the version 2 code reads these columns and this table) and rebuild the version 1 aggregates
-- afterwards. DROP COLUMN needs SQLite 3.35+ (D1 has it); explorar_pais_prueba has no index or
-- view on these columns.
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/manual/0021_explorar_selecciones.deshacer.sql
DROP TABLE IF EXISTS explorar_pais_tirador;
ALTER TABLE explorar_pais_prueba DROP COLUMN tipo;
ALTER TABLE explorar_pais_prueba DROP COLUMN directa_vb;
ALTER TABLE explorar_pais_prueba DROP COLUMN directa_va;
ALTER TABLE explorar_pais_prueba DROP COLUMN poule_vb;
ALTER TABLE explorar_pais_prueba DROP COLUMN poule_va;
