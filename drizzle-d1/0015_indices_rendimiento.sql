-- Índices de rendimiento (medidos con tests/perf/rutas.mts sobre la copia de producción; ver docs/rendimiento.md).
--
-- Sólo índices: no crea ni cambia tablas, columnas, triggers ni restricciones, y no escribe ninguna fila.
-- Un CREATE INDEX no dispara los triggers de guarda ni de cargo de las tablas sport_*, así que no hace
-- falta lease ni toca el ledger. Mantenerlos sí cuesta: cada fila que se inserte o cambie la columna
-- indexada escribe además una fila de índice (D1 la cobra como fila escrita, el ledger no la ve).
-- Por eso son pocos, estrechos y, donde se puede, parciales.
--
-- Aplicar en remoto con `wrangler d1 execute calendario-fie-fede-db --remote --file drizzle-d1/0015_indices_rendimiento.sql`
-- (la base remota no lleva registro de migraciones). Es idempotente.

-- 1. getDataFreshness (en el layout: TODAS las páginas). `ORDER BY last_seen_at DESC LIMIT 1` recorría
--    `event` entero y lo ordenaba: 984 filas leídas por petición -> 1.
--    Coste de escritura: una fila de índice por evento cada vez que el scraper actualiza last_seen_at
--    (unos 500 por pasada).
CREATE INDEX IF NOT EXISTS event_last_seen_idx ON event (last_seen_at);

-- 2. Sesión (cada petición con sesión): managed-auth.ts y session.ts buscan la cuenta por
--    `lower(trim(email)) = ?`, que no puede usar user_profile_email_unique. Hoy son 4 cuentas; con
--    miles, cada página leería miles de filas sólo para saber quién eres. La expresión tiene que ser
--    idéntica a la de la consulta.
CREATE INDEX IF NOT EXISTS user_profile_email_norm_idx ON user_profile (lower(trim(email)));

-- 3. Edición (src/lib/sport/explorar/ediciones*.ts): los enlaces de directo de las pruebas se cruzan
--    por (fact_kind = 'link', season, competition_key) y el único índice útil empieza por `source`,
--    que la consulta filtra con LIKE. SQLite construía en cada petición un índice automático sobre
--    toda sport_import_coverage: 40.951 filas leídas por edición -> 0-12.
--    Parcial: sólo las filas 'link' (hoy ninguna), así que casi no cuesta escrituras.
CREATE INDEX IF NOT EXISTS sport_import_coverage_enlace_idx
  ON sport_import_coverage (season, competition_key) WHERE fact_kind = 'link';

-- 4. Ranking mundial por persona (gruposDeMisTiradoresFie en /ranking y el resumen mundial del perfil):
--    el cruce por fie_id recorría la clasificación FIE entera (11.655 filas) para devolver 0-6.
--    Coste: fie_clasificacion se rehace en cada lectura de la FIE (~11.700 filas de índice por pasada).
CREATE INDEX IF NOT EXISTS fie_clasificacion_fie_idx ON fie_clasificacion (fie_id, season);

-- 5. ¿Es mío este perfil? (depsEvidenciaDb.externos, en el perfil y en Buscar): `value IN (...)` sin
--    `scheme` no puede usar sport_external_id_lookup_idx (scheme, value, scope_source) y barría la
--    tabla: 51.985 filas por carga -> las de esas licencias.
--    Alternativa sin coste de escritura: añadir `scheme IN ('rfee_license', 'fie_addr_id')` a la
--    consulta (el CHECK de la tabla no admite otros esquemas) y quitar este índice.
CREATE INDEX IF NOT EXISTS sport_external_id_value_idx ON sport_external_id (value);

-- 6. El de 0006 (calendario pasado por event_competition_id). La exportación de producción del
--    lote 8 no lo trae; si ya está, no hace nada.
CREATE INDEX IF NOT EXISTS sport_competition_event_competition_idx
  ON sport_competition (event_competition_id);
