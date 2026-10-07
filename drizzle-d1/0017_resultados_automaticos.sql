-- Automatic results ingestion (src/lib/ingest/resultados-auto, cron /api/cron/resultados).
-- Additive only: four new tables that no deployed code reads. They live OUTSIDE the sport_*
-- namespace on purpose: no fence or charge triggers, so they never consume the 8 GiB
-- capacity ledger, and scripts/indexado/sincronizar-d1.ts never copies them.
-- Without this migration the cron answers {ok:false,status:'migracion_pendiente'} and writes nothing.

-- One row per source unit (a FIE competition, a Skermo results row, a PDF document) and one
-- row per index ('indice|fie|<season>', 'indice|skermo|<season>'). `huella` is the SHA-256 of
-- the facts last written: an unchanged source is skipped without touching sport_*.
-- `escrito` is the key of the bouts (or PDF document) this unit wrote itself. Bouts or a
-- document already loaded under another key came from a manual batch and are never touched.
CREATE TABLE IF NOT EXISTS resultado_auto_unidad (
  clave TEXT PRIMARY KEY NOT NULL CHECK (length(clave) BETWEEN 3 AND 300),
  fuente TEXT NOT NULL CHECK (fuente IN ('fie', 'skermo', 'pdf', 'indice')),
  temporada TEXT NOT NULL,
  fecha TEXT CHECK (fecha IS NULL OR fecha GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  -- pendiente: never read; esperando: read, source not final yet; hecho: written and final;
  -- revision: blocked in resultado_auto_revision; descartada: out of scope (team, other source...).
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'esperando', 'hecho', 'revision', 'descartada', 'error')),
  huella TEXT,
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (typeof(intentos) = 'integer' AND intentos >= 0),
  proxima INTEGER NOT NULL CHECK (typeof(proxima) = 'integer'),
  ultima INTEGER CHECK (ultima IS NULL OR typeof(ultima) = 'integer'),
  detalle TEXT CHECK (detalle IS NULL OR length(detalle) <= 300),
  escrito TEXT CHECK (escrito IS NULL OR length(escrito) BETWEEN 1 AND 300),
  -- Small JSON with what the reader needs (Skermo index row, PDF URL...). Never a page body.
  datos TEXT CHECK (datos IS NULL OR (json_valid(datos) AND length(datos) <= 8000))
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS resultado_auto_unidad_proxima_idx ON resultado_auto_unidad (proxima, estado);

-- Review queue. Nothing in it was written to sport_*. `datos` keeps the reasons and counts,
-- never a PDF text or a model answer.
CREATE TABLE IF NOT EXISTS resultado_auto_revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (length(motivo) BETWEEN 1 AND 80),
  datos TEXT CHECK (datos IS NULL OR (json_valid(datos) AND length(datos) <= 8000)),
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'resuelta', 'descartada')),
  creada_en INTEGER NOT NULL CHECK (typeof(creada_en) = 'integer'),
  resuelta_en INTEGER CHECK (resuelta_en IS NULL OR typeof(resuelta_en) = 'integer')
);
CREATE UNIQUE INDEX IF NOT EXISTS resultado_auto_revision_abierta_key
  ON resultado_auto_revision (clave, motivo) WHERE estado = 'abierta';

-- Events for notifications. Append-only with a monotonic id: a consumer keeps its own cursor
-- (last id read) and reads `WHERE id > ?`. Rows older than 120 days are purged by the cron.
CREATE TABLE IF NOT EXISTS resultado_auto_evento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- prueba_publicada: first results of a competition; fases_publicadas: first pools/tableau;
  -- resultado_persona: a new placing of a (canonical) person.
  tipo TEXT NOT NULL CHECK (tipo IN ('prueba_publicada', 'fases_publicadas', 'resultado_persona')),
  competition_id TEXT NOT NULL,
  person_id TEXT,
  posicion INTEGER CHECK (posicion IS NULL OR typeof(posicion) = 'integer'),
  datos TEXT CHECK (datos IS NULL OR (json_valid(datos) AND length(datos) <= 2000)),
  creado_en INTEGER NOT NULL CHECK (typeof(creado_en) = 'integer'),
  CHECK ((tipo = 'resultado_persona') = (person_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS resultado_auto_evento_key
  ON resultado_auto_evento (tipo, competition_id, coalesce(person_id, ''));
CREATE INDEX IF NOT EXISTS resultado_auto_evento_persona_idx ON resultado_auto_evento (person_id, id);

-- Daily usage counters (UTC day): AI calls and estimated neurons, sport_* rows written,
-- source requests and ledger bytes charged. The cron stops a kind once its daily cap is reached.
CREATE TABLE IF NOT EXISTS resultado_auto_consumo (
  dia TEXT NOT NULL CHECK (dia GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  clave TEXT NOT NULL CHECK (clave IN ('ia_llamadas', 'ia_neuronas', 'filas', 'peticiones', 'bytes_ledger')),
  valor INTEGER NOT NULL CHECK (typeof(valor) = 'integer' AND valor >= 0),
  PRIMARY KEY (dia, clave)
) WITHOUT ROWID;
