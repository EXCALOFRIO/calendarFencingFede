-- In-app notifications (bell + inbox), per-type and per-channel preferences, Web Push
-- subscriptions, the sport-event outbox the ingest writes to, and the last profile reading
-- (ranking / olympic status) that changes are compared against.
-- Contract: src/db/schema/notificaciones.ts; code: src/lib/notificaciones/.
--
-- Additive only: six new application tables that the currently deployed code never reads.
-- They live outside the sport_* namespace, so there are no write-lease or capacity triggers.
-- Apply before deploying the code that uses them; until then that code reports
-- «sin_migracion» from the cron and the bell renders without a counter.
--
-- Privacy: notification text carries a person's name, the competition and the placing only;
-- never a birth year, a photo or anything else about a minor.

-- One row per notice and profile. `clave` is the dedupe key inside the profile: the same
-- notice (same competition, same deadline, same profile change) is a single row however many
-- times the generators run. `grupo` groups rows of the same competition/event in the inbox.
-- en_bandeja = 0: stored only to dedupe and to push while the bell channel is switched off.
CREATE TABLE IF NOT EXISTS notificacion (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('inscripciones', 'seguidos', 'perfil', 'calendario', 'prueba')),
  clave TEXT NOT NULL CHECK (length(clave) BETWEEN 1 AND 200),
  grupo TEXT NOT NULL CHECK (length(grupo) BETWEEN 1 AND 200),
  titulo TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  cuerpo TEXT NOT NULL CHECK (length(cuerpo) <= 1000),
  -- Internal path only ('/...'), never an external URL.
  url TEXT NOT NULL CHECK (substr(url, 1, 1) = '/' AND substr(url, 1, 2) <> '//' AND length(url) <= 700),
  datos TEXT CHECK (datos IS NULL OR (typeof(datos) = 'text' AND json_valid(datos))),
  en_bandeja INTEGER NOT NULL DEFAULT 1 CHECK (en_bandeja IN (0, 1)),
  leida_en INTEGER CHECK (leida_en IS NULL OR typeof(leida_en) = 'integer'),
  creada_en INTEGER NOT NULL CHECK (typeof(creada_en) = 'integer'),
  actualizada_en INTEGER NOT NULL CHECK (typeof(actualizada_en) = 'integer'),
  push_enviada_en INTEGER CHECK (push_enviada_en IS NULL OR typeof(push_enviada_en) = 'integer')
);
CREATE UNIQUE INDEX IF NOT EXISTS notificacion_clave_key ON notificacion (profile_id, clave);
CREATE INDEX IF NOT EXISTS notificacion_bandeja_idx ON notificacion (profile_id, en_bandeja, actualizada_en);
CREATE INDEX IF NOT EXISTS notificacion_no_leidas_idx ON notificacion (profile_id) WHERE leida_en IS NULL AND en_bandeja = 1;

-- Missing row = the default (everything on). Only explicit choices are stored.
CREATE TABLE IF NOT EXISTS notificacion_preferencia (
  profile_id TEXT NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  clave TEXT NOT NULL CHECK (clave IN (
    'tipo:inscripciones', 'tipo:seguidos', 'tipo:perfil', 'tipo:calendario',
    'canal:campana', 'canal:push'
  )),
  activa INTEGER NOT NULL CHECK (activa IN (0, 1)),
  actualizada_en INTEGER NOT NULL CHECK (typeof(actualizada_en) = 'integer'),
  PRIMARY KEY (profile_id, clave)
) WITHOUT ROWID;

-- One row per browser/device subscription (W3C Push API). The endpoint is the identity:
-- the same device signing in with another account takes the subscription over.
-- Rows answered 404/410 by the push service are deleted when sending.
CREATE TABLE IF NOT EXISTS notificacion_suscripcion (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL CHECK (substr(endpoint, 1, 8) = 'https://' AND length(endpoint) <= 1000),
  -- base64url, uncompressed P-256 point (65 bytes) and 16-byte auth secret.
  p256dh TEXT NOT NULL CHECK (length(p256dh) BETWEEN 80 AND 100),
  auth TEXT NOT NULL CHECK (length(auth) BETWEEN 16 AND 32),
  dispositivo TEXT CHECK (dispositivo IS NULL OR length(dispositivo) <= 80),
  creada_en INTEGER NOT NULL CHECK (typeof(creada_en) = 'integer'),
  ultimo_envio_en INTEGER CHECK (ultimo_envio_en IS NULL OR typeof(ultimo_envio_en) = 'integer'),
  fallos INTEGER NOT NULL DEFAULT 0 CHECK (typeof(fallos) = 'integer' AND fallos >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS notificacion_suscripcion_endpoint_key ON notificacion_suscripcion (endpoint);
CREATE INDEX IF NOT EXISTS notificacion_suscripcion_perfil_idx ON notificacion_suscripcion (profile_id);

-- Outbox written by the sport ingest: «results published for competition X» or «new result for
-- persons Y in competition X». competition_id is sport_competition.id without a foreign key on
-- purpose (sport rows are rebuilt by the sync; a dangling event is simply skipped).
CREATE TABLE IF NOT EXISTS notificacion_evento (
  id TEXT PRIMARY KEY NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('resultados_publicados', 'resultado_nuevo')),
  competition_id TEXT NOT NULL CHECK (length(competition_id) BETWEEN 1 AND 64),
  person_ids TEXT CHECK (person_ids IS NULL OR (typeof(person_ids) = 'text' AND json_valid(person_ids))),
  creado_en INTEGER NOT NULL CHECK (typeof(creado_en) = 'integer'),
  procesado_en INTEGER CHECK (procesado_en IS NULL OR typeof(procesado_en) = 'integer')
);
CREATE INDEX IF NOT EXISTS notificacion_evento_pendiente_idx ON notificacion_evento (procesado_en, creado_en);

-- Read cursor over append-only event feeds owned by other code. fuente 'resultado_auto_evento':
-- the last id of that table (0014_resultados_automaticos.sql) already copied into
-- notificacion_evento. The first read starts at the current max(id): no backlog flood.
CREATE TABLE IF NOT EXISTS notificacion_cursor (
  fuente TEXT PRIMARY KEY NOT NULL CHECK (length(fuente) BETWEEN 1 AND 60),
  ultimo_id INTEGER NOT NULL CHECK (typeof(ultimo_id) = 'integer' AND ultimo_id >= 0),
  actualizado_en INTEGER NOT NULL CHECK (typeof(actualizado_en) = 'integer')
) WITHOUT ROWID;

-- Last reading of each profile datum: clave 'nacional:<list>', 'internacional:<body>:<list>',
-- 'olimpico:<weapon>-<gender>'; valor is what is compared ('2025-2026|5', 'clasificado').
-- person_id is the canonical sport_person.id, again without a foreign key.
CREATE TABLE IF NOT EXISTS notificacion_lectura (
  person_id TEXT NOT NULL CHECK (length(person_id) BETWEEN 1 AND 64),
  clave TEXT NOT NULL CHECK (length(clave) BETWEEN 1 AND 120),
  valor TEXT NOT NULL CHECK (length(valor) <= 200),
  leida_en INTEGER NOT NULL CHECK (typeof(leida_en) = 'integer'),
  PRIMARY KEY (person_id, clave)
) WITHOUT ROWID;
