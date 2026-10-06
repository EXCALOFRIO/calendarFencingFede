/**
 * Dos ayudas de los arneses de capturas para los enlaces «En directo /
 * Resultados», las dos sin tocar la copia de la base:
 *
 *  · DIRECTOS=<fichero .sql>: una tabla TEMPORAL `live_source` tapa a la de la
 *    copia en esta conexión, con lo que ya hubiera más las filas del fichero
 *    (el que genera `scripts/enlaces-directo-inicial.ts`).
 *  · HOY=AAAA-MM-DD: el reloj del proceso se para ese día a las 12:00 de
 *    Madrid, para fotografiar un torneo «en directo».
 */
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export function aplicarDirectos(sqlite: DatabaseSync): void {
  const fichero = process.env.DIRECTOS;
  if (!fichero) return;
  sqlite.exec(`CREATE TEMP TABLE live_source (
    id text, event_id text NOT NULL, event_competition_id text, platform text NOT NULL,
    kind text NOT NULL DEFAULT 'resultados', url text NOT NULL, label text, added_by_profile_id text,
    is_automatic integer NOT NULL DEFAULT 0, created_at integer, match_rule text)`);
  sqlite.exec(`INSERT INTO temp.live_source
    (id, event_id, event_competition_id, platform, kind, url, label, added_by_profile_id, is_automatic, created_at)
    SELECT id, event_id, event_competition_id, platform, kind, url, label, added_by_profile_id, is_automatic, created_at
      FROM main.live_source`);
  sqlite.exec(readFileSync(fichero, 'utf8'));
  sqlite.exec(`UPDATE temp.live_source SET id = lower(hex(randomblob(16))) WHERE id IS NULL`);
  const n = sqlite.prepare('SELECT count(*) n FROM temp.live_source').get() as { n: number };
  console.log(`  directos: ${n.n} enlaces en la tabla temporal`);
}

export function fijarHoy(): void {
  const hoy = process.env.HOY;
  if (!hoy) return;
  const fijo = new Date(`${hoy}T12:00:00+02:00`).getTime();
  const Real = Date;
  class Parado extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fijo);
      else super(...(args as [string]));
    }
    static now() {
      return fijo;
    }
  }
  globalThis.Date = Parado as DateConstructor;
}
