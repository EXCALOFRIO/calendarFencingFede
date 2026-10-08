-- Head to head of national teams, version 2 of the country aggregates (VERSION_PAISES = 2 in
-- src/lib/sport/explorar/pais-indice-sql.ts). Additive only, outside the sport_* namespace (no
-- fence or charge triggers, no foreign keys, never copied by sincronizar-d1):
--   * explorar_pais_prueba gains the wins per phase and the competition type. The deployed code
--     never names these columns, and until the next rebuild they hold their defaults.
--   * explorar_pais_tirador is new: one row per person and rival country.
-- Apply BEFORE the version 2 rebuild (scripts/indice-explorar.ts). Rollout recipe and measured
-- costs: docs/selecciones-comparativa.md.
--
--   node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/0021_explorar_selecciones.sql
--
-- Inverse: drizzle-d1/manual/0021_explorar_selecciones.deshacer.sql.

-- Wins of side A and side B in poules and in direct elimination (tableau), and the competition
-- type of clasificarCompeticion (CTO_MUNDO, COPA_MUNDO, ...).
ALTER TABLE explorar_pais_prueba ADD COLUMN poule_va INTEGER NOT NULL DEFAULT 0;
ALTER TABLE explorar_pais_prueba ADD COLUMN poule_vb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE explorar_pais_prueba ADD COLUMN directa_va INTEGER NOT NULL DEFAULT 0;
ALTER TABLE explorar_pais_prueba ADD COLUMN directa_vb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE explorar_pais_prueba ADD COLUMN tipo TEXT NOT NULL DEFAULT '';

-- Individual bouts of a person against the fencers of a rival country, in both orientations (one
-- row for each side of each bout), per season and with temporada '' for all seasons. Bouts with
-- the same score on both sides (unpublished 0-0) do not count anywhere. tf/tc: touches for and
-- against; ultima: date of the latest competition. The key is pair, season, person: a screen
-- reads only its pair and season and groups by person in key order (no sort).
CREATE TABLE IF NOT EXISTS explorar_pais_tirador (
  pais TEXT NOT NULL,
  rival TEXT NOT NULL,
  temporada TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  genero TEXT NOT NULL,
  arma TEXT NOT NULL,
  categoria TEXT NOT NULL,
  modalidad TEXT NOT NULL,
  asaltos INTEGER NOT NULL,
  victorias INTEGER NOT NULL,
  derrotas INTEGER NOT NULL,
  tf INTEGER NOT NULL,
  tc INTEGER NOT NULL,
  poule_v INTEGER NOT NULL,
  poule_d INTEGER NOT NULL,
  directa_v INTEGER NOT NULL,
  directa_d INTEGER NOT NULL,
  ultima TEXT NOT NULL,
  PRIMARY KEY (pais, rival, temporada, persona_id, genero, arma, categoria, modalidad)
) WITHOUT ROWID;
