-- Read-only checks after 0021 and the version 2 rebuild of the country aggregates.
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/manual/0021_explorar_selecciones.comprobar.sql
-- Expected: version 2; the five new columns; tirador rows > 0; no bout without a winner
-- (asaltos = victorias + derrotas) in either table.
SELECT version, construido_en FROM explorar_pais_estado;
SELECT name FROM pragma_table_info('explorar_pais_prueba') WHERE name IN ('poule_va', 'poule_vb', 'directa_va', 'directa_vb', 'tipo');
SELECT count(*) AS filas, count(DISTINCT persona_id) AS personas FROM explorar_pais_tirador;
SELECT count(*) AS descuadres FROM explorar_pais_prueba WHERE asaltos <> victorias_a + victorias_b;
SELECT count(*) AS descuadres FROM explorar_pais_tirador WHERE asaltos <> victorias + derrotas;
SELECT tipo, count(*) AS pruebas FROM explorar_pais_prueba GROUP BY tipo ORDER BY 2 DESC;
