-- Derived, rebuildable profile data for Explorar (full name, birth, hand, height,
-- club). Built offline by scripts/indexado/aplicar-perfiles.ts from the FIE
-- athlete API, Skermo classifications, the RFEE ranking and sport_result clubs.
--
-- Same pattern as 0004_indice_explorar.sql: it lives outside the sport_*
-- namespace on purpose (no fence or charge triggers, no foreign keys) and
-- sincronizar-d1 never copies it; aplicar-perfiles.ts emits its own SQL.
-- One row per surviving person (sport_person.merged_into_person_id IS NULL).
-- A row for a person that was merged afterwards is stale: readers must join on
-- the canonical id resolved through sport_person, never trust it blindly.
--
-- Privacy: birth_date, hand, height_cm and extra are only written for persons
-- who are not possible minors (posibleMenor in src/lib/sport/explorar/ficha.ts);
-- birth_date only when the build ran with --con-fecha. birth_year is also
-- copied to sport_person.birth_year (existing column), which drives the minor veto.
CREATE TABLE perfil_deportista (
  person_id TEXT PRIMARY KEY NOT NULL,
  -- «Carlos Llavador Fernández»: given names + surnames, proper case, accents
  -- only when a source of this same person publishes them.
  full_name TEXT,
  given_name TEXT,
  family_name TEXT,
  -- 1 when full_name adds words to sport_person.display_name (second surname,
  -- completed initial or truncation).
  name_extended INTEGER NOT NULL DEFAULT 0 CHECK (name_extended IN (0, 1)),
  birth_year INTEGER CHECK (birth_year IS NULL OR (typeof(birth_year) = 'integer' AND birth_year BETWEEN 1900 AND 2100)),
  birth_date TEXT CHECK (birth_date IS NULL OR birth_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  -- e.g. 'fie', 'skermo_clasificacion+ranking_rfee', 'rfee_pdf_subdivision'.
  birth_source TEXT,
  -- 'L' left-handed (zurdo), 'R' right-handed (diestro). FIE only.
  hand TEXT CHECK (hand IS NULL OR hand IN ('L', 'R')),
  height_cm INTEGER CHECK (height_cm IS NULL OR (typeof(height_cm) = 'integer' AND height_cm BETWEEN 120 AND 230)),
  -- Most recent club. Spanish sources publish an internal code ('SAMA-M'),
  -- never a name; club_name only when a source publishes a readable name.
  club_code TEXT,
  club_name TEXT,
  club_source TEXT,
  club_seen_on TEXT,
  fie_id INTEGER CHECK (fie_id IS NULL OR (typeof(fie_id) = 'integer' AND fie_id > 0)),
  -- Small JSON: {"fie":{"rank","weapon","category","medals","clubs","residence","licenseStatus"},"name":{"source","reason","accents"}}
  extra TEXT CHECK (extra IS NULL OR (typeof(extra) = 'text' AND json_valid(extra))),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer')
);
