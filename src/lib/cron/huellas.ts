import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { tocaPorPeriodo } from './niveles';

/**
 * Huella del contenido de las páginas que se descargan enteras cada noche
 * (los calendarios de Skermo, ~2,5 MB). Si la página es idéntica a la de la
 * última lectura COMPLETA, no se vuelve a parsear ni a cruzar con la base.
 *
 * Vive en `refresco_programado` (0012), sin migración nueva, con dos filas por
 * página: la huella (los 52 primeros bits del SHA-256, que caben en un entero
 * exacto de JavaScript y en la columna INTEGER) y el instante de la última
 * lectura completa. Sin la tabla, todo cuenta como «nunca leído» y se procesa
 * como antes.
 *
 * Para forzar una relectura: `DELETE FROM refresco_programado WHERE tarea LIKE 'huella_pagina%'`,
 * o lanzar la fuente con `?forzar=1`.
 */
export const TAREA_HUELLA = 'huella_pagina';
export const TAREA_HUELLA_LEIDA = 'huella_pagina_leida';
/** Cada cuánto se procesa la página entera aunque no haya cambiado. */
export const DIAS_LECTURA_COMPLETA = 7;

export type HuellaGuardada = { huella: number | null; leida: Date | null };

/** 52 bits del SHA-256 en hexadecimal: un entero seguro, no un texto. */
export function huellaEntera(sha256Hex: string): number {
  if (!/^[0-9a-f]{13}/i.test(sha256Hex)) throw new Error('huella no hexadecimal');
  return Number.parseInt(sha256Hex.slice(0, 13), 16);
}

/** ¿Se puede saltar el procesado? Solo si la página es igual y la última lectura completa es reciente. */
export function puedeSaltarPagina(previa: HuellaGuardada | undefined, huella: number, ahora: Date): boolean {
  if (!previa || previa.huella === null || previa.leida === null) return false;
  if (previa.huella !== huella) return false;
  return !tocaPorPeriodo(ahora, previa.leida, DIAS_LECTURA_COMPLETA);
}

export async function leerHuellas(claves: readonly string[]): Promise<Map<string, HuellaGuardada>> {
  const salida = new Map<string, HuellaGuardada>();
  if (claves.length === 0) return salida;
  try {
    const { rows } = await db.execute<{ tarea: string; clave: string; valor: number }>(sql`
      SELECT tarea, clave, ultima_lectura AS valor FROM refresco_programado
       WHERE tarea IN (${TAREA_HUELLA}, ${TAREA_HUELLA_LEIDA})
         AND clave IN (SELECT value FROM json_each(${JSON.stringify(claves)}))`);
    for (const r of rows) {
      const clave = String(r.clave);
      const actual = salida.get(clave) ?? { huella: null, leida: null };
      if (r.tarea === TAREA_HUELLA) actual.huella = Number(r.valor);
      else actual.leida = new Date(Number(r.valor));
      salida.set(clave, actual);
    }
  } catch {
    // Tabla ausente: nada guardado.
  }
  return salida;
}

/** Una sola sentencia para todas las páginas leídas enteras en la pasada. */
export async function guardarHuellas(entradas: readonly { clave: string; huella: number }[], cuando: Date): Promise<void> {
  if (entradas.length === 0) return;
  const filas = entradas.flatMap((e) => [
    { t: TAREA_HUELLA, c: e.clave, v: e.huella },
    { t: TAREA_HUELLA_LEIDA, c: e.clave, v: cuando.getTime() },
  ]);
  try {
    await db.execute(sql`
      INSERT INTO refresco_programado (tarea, clave, ultima_lectura)
      SELECT json_extract(value, '$.t'), json_extract(value, '$.c'), json_extract(value, '$.v')
        FROM json_each(${JSON.stringify(filas)})
      -- Sin el WHERE, SQLite lee el ON CONFLICT como condición de un JOIN.
      WHERE true
      ON CONFLICT (tarea, clave) DO UPDATE SET ultima_lectura = excluded.ultima_lectura`);
  } catch {
    // Sin la tabla no se recuerda; la próxima pasada procesa la página entera.
  }
}
