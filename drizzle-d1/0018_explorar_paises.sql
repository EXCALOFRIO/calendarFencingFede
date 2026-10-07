-- Derived, rebuildable aggregates for the country pages of Explorar
-- (/explorar/pais/[codigo] and /explorar/pais/[codigo]/contra/[otro]).
-- Additive only: new explorar_* tables the deployed code never reads. Same rules as 0004:
-- outside the sport_* namespace (no fence or charge triggers, no foreign keys, never copied by
-- sincronizar-d1). Apply it BEFORE the next rebuild of the Explorar index, which now also fills
-- these tables (scripts/indice-explorar.ts, SENTENCIAS_PAISES in
-- src/lib/sport/explorar/pais-indice-sql.ts):
--
--   wrangler d1 execute calendario-fie-fede-db --remote --file drizzle-d1/0018_explorar_paises.sql
--
-- Until the first rebuild there is no state row and the country pages say there is no data yet.
-- Only international competitions count (FIE, EFC, or an edition abroad / an international
-- calendar event). Filter columns use '' for "all" where a table is rolled up.

-- One row. version: format of the aggregates; construido_en: rebuild time (part of the cache key).
CREATE TABLE IF NOT EXISTS explorar_pais_estado (
  key TEXT PRIMARY KEY NOT NULL CHECK (key = 'global'),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer'),
  construido_en INTEGER NOT NULL CHECK (typeof(construido_en) = 'integer')
);

-- FIE country codes the rebuild accepts (club codes from national sources are not countries).
CREATE TABLE IF NOT EXISTS explorar_pais_codigo (
  codigo TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;

-- Performance of a country per weapon, gender, category, mode ('I' individual, 'E' teams) and
-- season. A screen sums the rows of its filters (a few hundred per country). pruebas, resultados,
-- medals and finales add up; tiradores (distinct people) is only exact for its own row.
CREATE TABLE IF NOT EXISTS explorar_pais_resumen (
  pais TEXT NOT NULL,
  arma TEXT NOT NULL,
  genero TEXT NOT NULL,
  categoria TEXT NOT NULL,
  modalidad TEXT NOT NULL,
  temporada TEXT NOT NULL,
  pruebas INTEGER NOT NULL,
  resultados INTEGER NOT NULL,
  tiradores INTEGER NOT NULL,
  oros INTEGER NOT NULL,
  platas INTEGER NOT NULL,
  bronces INTEGER NOT NULL,
  finales INTEGER NOT NULL,
  mejor INTEGER,
  PRIMARY KEY (pais, arma, genero, categoria, modalidad, temporada)
) WITHOUT ROWID;

-- Distinct people with individual results, rolled up over weapon, gender and category ('' = all).
CREATE TABLE IF NOT EXISTS explorar_pais_tiradores (
  pais TEXT NOT NULL,
  arma TEXT NOT NULL,
  genero TEXT NOT NULL,
  categoria TEXT NOT NULL,
  tiradores INTEGER NOT NULL,
  PRIMARY KEY (pais, arma, genero, categoria)
) WITHOUT ROWID;

-- Every podium of a country, newest first (the "best results" list).
CREATE TABLE IF NOT EXISTS explorar_pais_medalla (
  pais TEXT NOT NULL,
  fecha TEXT NOT NULL,
  resultado_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  persona_id TEXT,
  puesto INTEGER NOT NULL,
  arma TEXT NOT NULL,
  genero TEXT NOT NULL,
  categoria TEXT NOT NULL,
  modalidad TEXT NOT NULL,
  temporada TEXT NOT NULL,
  PRIMARY KEY (pais, fecha, resultado_id)
) WITHOUT ROWID;

-- One row per competition and pair of countries that met in it (pais_a < pais_b), with the
-- bouts between them: individual bouts and team matches (modalidad 'E'). The head to head of a
-- pair is the sum of its rows. asaltos_ids is the JSON array of sport_bout ids, so the detail reads
-- exactly those bouts by primary key; an id starting with '~' is a bout whose side A is pais_b.
CREATE TABLE IF NOT EXISTS explorar_pais_prueba (
  pais_a TEXT NOT NULL,
  pais_b TEXT NOT NULL,
  fecha TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  arma TEXT NOT NULL,
  genero TEXT NOT NULL,
  categoria TEXT NOT NULL,
  modalidad TEXT NOT NULL,
  temporada TEXT NOT NULL,
  asaltos INTEGER NOT NULL,
  victorias_a INTEGER NOT NULL,
  victorias_b INTEGER NOT NULL,
  tocados_a INTEGER NOT NULL,
  tocados_b INTEGER NOT NULL,
  asaltos_ids TEXT NOT NULL
);
-- A rowid table without a key: the rebuild only appends and builds both indexes at the end.
CREATE UNIQUE INDEX IF NOT EXISTS explorar_pais_prueba_pareja_idx
  ON explorar_pais_prueba (pais_a, pais_b, fecha, competition_id);
-- With weapon, gender and category chosen, the list and the balance read only their own rows.
CREATE INDEX IF NOT EXISTS explorar_pais_prueba_filtro_idx
  ON explorar_pais_prueba (pais_a, pais_b, arma, genero, categoria, fecha, competition_id);

-- Totals per rival, for the rival picker of a country page (both orientations): individual
-- bouts (asaltos, victorias, derrotas) and team matches (encuentros, ganados, perdidos).
CREATE TABLE IF NOT EXISTS explorar_pais_rival (
  pais_a TEXT NOT NULL,
  pais_b TEXT NOT NULL,
  asaltos INTEGER NOT NULL,
  victorias INTEGER NOT NULL,
  derrotas INTEGER NOT NULL,
  encuentros INTEGER NOT NULL,
  ganados INTEGER NOT NULL,
  perdidos INTEGER NOT NULL,
  ultima TEXT NOT NULL,
  PRIMARY KEY (pais_a, pais_b)
) WITHOUT ROWID;
