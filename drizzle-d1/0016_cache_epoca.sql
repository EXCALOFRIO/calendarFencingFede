-- Épocas de la caché compartida (src/lib/cache/versiones.ts e invalidar.ts).
--
-- Una fila por dependencia ('deporte', 'calendario', 'ranking', 'ranking-fie'); `invalidarCache`
-- sube `epoch` y las claves de caché que dependen de ella cambian. La aplicación la lee como mucho
-- una vez cada 30 s por isolate. No es una tabla sport_*: no lleva guarda ni ledger.
--
-- Sin esta tabla la caché funciona igual con la marca del ledger (sport_capacity_ledger) para lo
-- deportivo; lo demás sólo caduca por tiempo. Aditiva e idempotente:
--   wrangler d1 execute calendario-fie-fede-db --remote --file drizzle-d1/0016_cache_epoca.sql
CREATE TABLE IF NOT EXISTS cache_epoch (
  namespace TEXT PRIMARY KEY NOT NULL CHECK (length(namespace) BETWEEN 1 AND 40),
  epoch INTEGER NOT NULL CHECK (typeof(epoch) = 'integer' AND epoch >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer')
) WITHOUT ROWID;
