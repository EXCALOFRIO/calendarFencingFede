import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * Última lectura por tarea y clave, en `refresco_programado`
 * (0012_refresco_programado.sql). Fuera del esquema de Drizzle a propósito:
 * ese esquema tiene que seguir idéntico al de Postgres.
 *
 * Sin la tabla (migración sin aplicar) todo cuenta como «nunca leído», que es
 * lo prudente: se lee como antes, no se deja de leer.
 */

export async function ultimasLecturas(tarea: string, claves: readonly string[]): Promise<Map<string, Date>> {
  const salida = new Map<string, Date>();
  if (claves.length === 0) return salida;
  try {
    const { rows } = await db.execute<{ clave: string; ultima: number }>(sql`
      SELECT clave, ultima_lectura AS ultima FROM refresco_programado
       WHERE tarea = ${tarea} AND clave IN (SELECT value FROM json_each(${JSON.stringify(claves)}))`);
    for (const r of rows) salida.set(String(r.clave), new Date(Number(r.ultima)));
  } catch {
    // Tabla ausente: nada leído.
  }
  return salida;
}

export async function anotarLecturas(tarea: string, claves: readonly string[], cuando = new Date()): Promise<void> {
  if (claves.length === 0) return;
  try {
    for (let i = 0; i < claves.length; i += 200) {
      await db.execute(sql`
        INSERT INTO refresco_programado (tarea, clave, ultima_lectura)
        SELECT ${tarea}, value, ${cuando.getTime()} FROM json_each(${JSON.stringify(claves.slice(i, i + 200))})
        -- Sin el WHERE, SQLite lee el ON CONFLICT como condición de un JOIN.
        WHERE true
        ON CONFLICT (tarea, clave) DO UPDATE SET ultima_lectura = excluded.ultima_lectura`);
    }
  } catch {
    // Sin la tabla no se recuerda; la próxima pasada volverá a leer.
  }
}
