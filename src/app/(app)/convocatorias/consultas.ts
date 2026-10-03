import { eq } from 'drizzle-orm';
import { enLista as inArray } from '@/lib/sqlite';
import { db } from '@/db';
import { callUpAthlete, eventCompetition } from '@/db/schema';
import type { Weapon } from '@/lib/auth/session';

/**
 * De qué arma es cada convocatoria.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ HACE FALTA UNA CONSULTA PARA ESTO
 * ---------------------------------------------------------------------------
 * `CallUpDetail` trae el arma de cada convocado, pero **ya formateada**:
 * `competitionLabel()` devuelve «Espada femenino · Absoluto», una cadena para
 * leer. Filtrar por arma deshaciendo esa cadena sería adivinar el dato a partir
 * de su presentación, y se rompe el día que alguien cambie una etiqueta.
 *
 * Así que el arma se pide como arma. Una consulta, agrupada por convocatoria.
 *
 * ---------------------------------------------------------------------------
 * UNA CONVOCATORIA PUEDE TENER VARIAS
 * ---------------------------------------------------------------------------
 * Casi siempre es una —«Selección de espada femenina — Copa Mundo»— pero un
 * campeonato de España se convoca con las tres armas en el mismo documento. Por
 * eso devuelve una lista y el filtro comprueba la intersección: si al
 * seleccionador de florete le toca algo de esa convocatoria, la ve entera.
 *
 * Y si una convocatoria no tiene NINGUNA prueba asignada —`event_competition_id`
 * es opcional en `call_up_athlete`— devuelve lista vacía, y el filtro la deja
 * pasar. Esconder algo cuyo arma se desconoce sería peor que enseñarlo: es
 * exactamente el fallo que se está arreglando, pero al revés.
 */
export async function armasPorConvocatoria(
  callUpIds: string[],
): Promise<Record<string, Weapon[]>> {
  if (callUpIds.length === 0) return {};

  const filas = await db
    .selectDistinct({
      callUpId: callUpAthlete.callUpId,
      weapon: eventCompetition.weapon,
    })
    .from(callUpAthlete)
    .innerJoin(
      eventCompetition,
      eq(callUpAthlete.eventCompetitionId, eventCompetition.id),
    )
    .where(inArray(callUpAthlete.callUpId, callUpIds));

  const salida: Record<string, Weapon[]> = {};
  for (const id of callUpIds) salida[id] = [];
  for (const f of filas) {
    if (!salida[f.callUpId].includes(f.weapon)) salida[f.callUpId].push(f.weapon);
  }
  return salida;
}
