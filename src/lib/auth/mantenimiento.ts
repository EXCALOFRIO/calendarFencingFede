import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { AHORA_SQL } from '@/lib/sqlite';

/**
 * Sólo elimina controles de abuso caducados. No consulta ni modifica Neon Auth,
 * invitaciones o perfiles. No devuelve los hashes privados de las claves.
 */
export async function limpiarAutenticacionCaducada(limitePorTabla = 500): Promise<number> {
  if (!Number.isSafeInteger(limitePorTabla) || limitePorTabla < 1 || limitePorTabla > 500) {
    throw new Error('Límite de mantenimiento no válido.');
  }
  let eliminadas = 0;
  for (const tabla of ['auth_throttle', 'auth_otp_challenge']) {
    const clave = 'key';
    const nombreSql = sql.identifier(tabla);
    const claveSql = sql.identifier(clave);
    const resultado = await db.execute<{ clave: string }>(sql`
      DELETE FROM ${nombreSql}
      WHERE ${claveSql} IN (
        SELECT ${claveSql} FROM ${nombreSql}
        WHERE expires_at <= ${AHORA_SQL}
        ORDER BY expires_at, ${claveSql}
        LIMIT ${limitePorTabla}
      )
      RETURNING 1 AS eliminada
    `);
    eliminadas += resultado.rows.length;
  }
  return eliminadas;
}
