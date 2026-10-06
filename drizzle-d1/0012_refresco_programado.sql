-- Per-key refresh state for the tiered schedulers (src/lib/cron/niveles.ts, src/lib/cron/refresco.ts).
-- Additive: a new table that the currently deployed code never reads. Apply before deploying the
-- code that uses it; until then that code behaves as if nothing had ever been read (it reads).
--
-- tarea: what is refreshed ('fie_torneo', 'fie_clasificacion', 'efc', 'skermo_final').
-- clave: the source key within the task (FIE tournament id, competition id, 'global').
-- ultima_lectura: epoch ms of the last successful read.
--
-- To force a refresh: DELETE FROM refresco_programado WHERE tarea = '<tarea>' [AND clave = '<clave>'];
-- or call the cron route with ?forzar=1 (see docs/tareas-programadas.md).
CREATE TABLE IF NOT EXISTS refresco_programado (
  tarea TEXT NOT NULL CHECK (length(tarea) BETWEEN 1 AND 40),
  clave TEXT NOT NULL CHECK (length(clave) BETWEEN 1 AND 120),
  ultima_lectura INTEGER NOT NULL CHECK (typeof(ultima_lectura) = 'integer'),
  PRIMARY KEY (tarea, clave)
) WITHOUT ROWID;
