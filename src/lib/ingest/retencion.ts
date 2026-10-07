import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { AHORA_SQL } from '@/lib/sqlite';

export const DIAS_CUARENTENA_RESUELTA = 30;
export const DIAS_EJECUCIONES = 90;
export const MAX_POR_TABLA = 500;
const DIA_MS = 86_400_000;

export type RetencionIngesta = { cuarentenaResuelta: number; ejecuciones: number };

/**
 * Retención de los registros de ingesta (no toca sport_*, ni sus guardas, ni el libro):
 *  - ingest_quarantine resuelta hace más de 30 días (las pendientes nunca);
 *  - ingest_run de hace más de 90 días que no tenga ninguna cuarentena (el ON DELETE CASCADE
 *    no arrastra nada), salvo la última de cada fuente y la última lectura útil
 *    (`ok` con elementos) de cada fuente, que leen las alertas y la cadencia del ranking.
 * La cuarentena va primero: una ejecución cuyas cuarentenas acaban de caducar se puede
 * borrar en la misma pasada. Cada tabla borra como mucho `limitePorTabla` filas por pasada.
 */
export async function limpiarRegistrosIngesta(db: Db, limitePorTabla = MAX_POR_TABLA): Promise<RetencionIngesta> {
  if (!Number.isSafeInteger(limitePorTabla) || limitePorTabla < 1 || limitePorTabla > MAX_POR_TABLA) {
    throw new Error('Límite de retención no válido.');
  }
  const cuarentena = await db.execute(sql`
    DELETE FROM ingest_quarantine
    WHERE id IN (
      SELECT id FROM ingest_quarantine
      WHERE resolved_at IS NOT NULL AND resolved_at < ${AHORA_SQL} - ${DIAS_CUARENTENA_RESUELTA * DIA_MS}
      ORDER BY resolved_at, id
      LIMIT ${limitePorTabla}
    )
    RETURNING 1 AS eliminada`);
  const ejecuciones = await db.execute(sql`
    DELETE FROM ingest_run
    WHERE id IN (
      SELECT r.id FROM ingest_run r
      WHERE r.started_at < ${AHORA_SQL} - ${DIAS_EJECUCIONES * DIA_MS}
        AND NOT EXISTS (SELECT 1 FROM ingest_quarantine q WHERE q.ingest_run_id = r.id)
        AND EXISTS (SELECT 1 FROM ingest_run n WHERE n.source = r.source AND n.started_at > r.started_at)
        AND NOT (r.status = 'ok' AND r.items_seen > 0 AND NOT EXISTS (
          SELECT 1 FROM ingest_run n
          WHERE n.source = r.source AND n.started_at > r.started_at AND n.status = 'ok' AND n.items_seen > 0))
      ORDER BY r.started_at, r.id
      LIMIT ${limitePorTabla}
    )
    RETURNING 1 AS eliminada`);
  return { cuarentenaResuelta: cuarentena.rows.length, ejecuciones: ejecuciones.rows.length };
}
