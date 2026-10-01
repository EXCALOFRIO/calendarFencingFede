import { sql } from 'drizzle-orm';
import type { eventCompetition } from '@/db/schema';

/**
 * Qué prueba es, sin depender de su id: arma + género + categoría + formato.
 *
 * Es la clave con la que se reconoce «el mismo florete femenino individual»
 * en la fila de Skermo y en la de la FIE, que son dos filas de
 * `event_competition`. Se calcula en Postgres para no traer cuatro columnas
 * más por cada inscrito. Vive aparte de `inscritos-union` para que el
 * calendario público no arrastre la sesión privada.
 */
export function clavePrueba(t: typeof eventCompetition) {
  return sql<string>`concat_ws('|', ${t.weapon}::text, ${t.gender}::text, ${t.category}::text, ${t.format}::text)`;
}
