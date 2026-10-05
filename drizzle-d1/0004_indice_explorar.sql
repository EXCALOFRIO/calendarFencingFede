-- Derived, rebuildable word index for Explorar search and suggestions. Apply
-- after 0000. It lives outside the sport_* namespace on purpose: no fence or
-- charge triggers, no foreign keys, and sincronizar-d1 never copies it.
--
-- Applying this file alone changes nothing visible: until the first rebuild
-- (scripts/indice-explorar.ts) there is no state row and the app keeps
-- using the live queries. The index only proposes and orders candidates; every
-- row shown is re-checked against the live sport_person / sport_person_alias
-- rows, and persons/aliases inserted after the rebuild are matched live.

-- One row. Rowid marks of sport_person / sport_person_alias at rebuild time:
-- rows above them are "not indexed yet" and are matched with LIKE.
CREATE TABLE explorar_indice_estado (
  key TEXT PRIMARY KEY NOT NULL CHECK (key = 'global'),
  persona_rowid INTEGER NOT NULL CHECK (typeof(persona_rowid) = 'integer'),
  alias_rowid INTEGER NOT NULL CHECK (typeof(alias_rowid) = 'integer'),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer'),
  construido_en INTEGER NOT NULL CHECK (typeof(construido_en) = 'integer')
);

-- One row per surviving person (merged_into_person_id IS NULL) at rebuild
-- time. `n` follows (name_normalized, id) order, so candidates sorted by n are
-- already in page order. `peso` = results of the merge group (suggestion rank).
CREATE TABLE explorar_persona (
  n INTEGER PRIMARY KEY,
  id TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  peso INTEGER NOT NULL
);
CREATE UNIQUE INDEX explorar_persona_orden_idx ON explorar_persona (name_normalized, id);

-- Every space-separated word of the survivor's name_normalized and of every
-- alias in its merge group.
CREATE TABLE explorar_token (
  token TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (token, n)
) WITHOUT ROWID;

-- Single-deletion neighbourhood of every indexed word of 4+ letters (the word
-- itself plus the word minus one letter). Two words share a key iff they are
-- within one insertion, deletion, substitution or adjacent swap.
CREATE TABLE explorar_variante (
  clave TEXT NOT NULL,
  palabra TEXT NOT NULL,
  PRIMARY KEY (clave, palabra)
) WITHOUT ROWID;
