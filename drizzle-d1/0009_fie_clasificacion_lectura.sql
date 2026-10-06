-- Last read of each FIE ranking group (src/lib/ingest/sources/fie-clasificacion-lectura.ts).
-- Apply after 0008. Additive only: the ingest tolerates the table not existing yet
-- (it just loses the read time) and readers fall back to max(fie_clasificacion.updated_at).
--
-- One row per (season, format, weapon, gender, category_raw), the same key the ingest
-- upserts and prunes. read_at is the time of the last successful, non-empty read, in
-- milliseconds since the epoch like the rest of the D1 schema. Failed or empty reads
-- never write here.
CREATE TABLE IF NOT EXISTS fie_clasificacion_lectura (
  season INTEGER NOT NULL CHECK (typeof(season) = 'integer'),
  format TEXT NOT NULL CHECK (format IN ('INDIVIDUAL', 'EQUIPOS')),
  weapon TEXT NOT NULL CHECK (weapon IN ('FLORETE', 'ESPADA', 'SABLE')),
  gender TEXT NOT NULL CHECK (gender IN ('M', 'F', 'MIXTO')),
  category_raw TEXT NOT NULL,
  -- Rows the FIE returned in that read.
  row_count INTEGER NOT NULL CHECK (typeof(row_count) = 'integer' AND row_count >= 0),
  -- Stored rows removed in that read because the FIE no longer listed them.
  deleted_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(deleted_count) = 'integer' AND deleted_count >= 0),
  read_at INTEGER NOT NULL CHECK (typeof(read_at) = 'integer'),
  source_url TEXT,
  PRIMARY KEY (season, format, weapon, gender, category_raw)
);
