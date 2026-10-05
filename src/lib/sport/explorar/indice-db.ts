import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { crearDetectorCondicion } from '@/lib/sport/esquema';
import { VERSION_INDICE } from './indice-sql';

/**
 * El índice cuenta como disponible con sus tablas y una reconstrucción de la
 * versión que entiende este código. Una vez disponible se recuerda (la
 * reconstrucción es atómica: nunca queda a medias ni vacía); si falta, se
 * vuelve a mirar al minuto, así que aplicar 0004 y reconstruir no necesita
 * desplegar ni reiniciar nada.
 */
export const indiceExplorarDisponible = crearDetectorCondicion(async () => {
  const { rows } = await db.execute<{ n: number }>(sql`
    SELECT count(*) AS n FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('explorar_indice_estado', 'explorar_persona', 'explorar_token', 'explorar_variante')`);
  if (Number(rows[0]?.n) !== 4) return false;
  const { rows: estado } = await db.execute<{ version: number }>(sql`
    SELECT version FROM explorar_indice_estado WHERE key = 'global'`);
  return Number(estado[0]?.version) === VERSION_INDICE;
});
