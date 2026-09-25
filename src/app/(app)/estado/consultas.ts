import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { rankingPoint, rankingSnapshot, season } from '@/db/schema';

/**
 * Lo que "Mi estado" necesita del ranking y que no vive en `my-status.ts`.
 *
 * Se lee del ÚLTIMO cálculo guardado (`ranking_snapshot`), nunca se recalcula
 * al vuelo: la pantalla enseña lo que hay, con su fecha. Si no hay cálculo, no
 * hay puesto que enseñar y se dice; no se pinta un cero.
 */

export type PuestoTemporada = {
  athleteId: string;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  position: number;
  totalPoints: number;
  /** Cuántas pruebas se le han contado para ese total. */
  pruebasContadas: number;
  /** Puestos ganados (+) o perdidos (−) desde el cálculo anterior. `null` si
   *  no hay un cálculo anterior con el que comparar, que no es lo mismo que
   *  "no se ha movido". */
  variacion: number | null;
  calculadoEl: Date;
};

/** Puntos que dejó una prueba concreta en el ranking de un tirador. */
export type PuntosDePrueba = {
  position: number;
  finalPoints: number;
  /** Si entra en las mejores N que cuentan para el total de la temporada. */
  cuenta: boolean;
  explicacion: string | null;
};

/** Las dos últimas fechas de cálculo de la temporada en curso. */
async function ultimosCalculos(seasonId: string): Promise<(Date | null)[]> {
  const filas = await db
    .selectDistinct({ computedAt: rankingSnapshot.computedAt })
    .from(rankingSnapshot)
    .where(eq(rankingSnapshot.seasonId, seasonId))
    .orderBy(desc(rankingSnapshot.computedAt))
    .limit(2);
  return [filas[0]?.computedAt ?? null, filas[1]?.computedAt ?? null];
}

/**
 * Puesto y puntos de cada tirador de la cuenta, en cada ranking en el que
 * aparezca (un M17 puede estar en el suyo y en el absoluto).
 */
export async function getPuestosDeTemporada(
  athleteIds: string[],
): Promise<PuestoTemporada[]> {
  if (athleteIds.length === 0) return [];

  const [temporada] = await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.current, true))
    .limit(1);
  if (!temporada) return [];

  const [ultimo, anterior] = await ultimosCalculos(temporada.id);
  if (!ultimo) return [];

  const [actuales, previos] = await Promise.all([
    db
      .select({
        athleteId: rankingSnapshot.athleteId,
        weapon: rankingSnapshot.weapon,
        gender: rankingSnapshot.gender,
        category: rankingSnapshot.category,
        position: rankingSnapshot.position,
        totalPoints: rankingSnapshot.totalPoints,
        countedEventIds: rankingSnapshot.countedEventIds,
      })
      .from(rankingSnapshot)
      .where(
        and(
          eq(rankingSnapshot.seasonId, temporada.id),
          eq(rankingSnapshot.computedAt, ultimo),
          inArray(rankingSnapshot.athleteId, athleteIds),
        ),
      ),
    anterior
      ? db
          .select({
            athleteId: rankingSnapshot.athleteId,
            weapon: rankingSnapshot.weapon,
            gender: rankingSnapshot.gender,
            category: rankingSnapshot.category,
            position: rankingSnapshot.position,
          })
          .from(rankingSnapshot)
          .where(
            and(
              eq(rankingSnapshot.seasonId, temporada.id),
              eq(rankingSnapshot.computedAt, anterior),
              inArray(rankingSnapshot.athleteId, athleteIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const clave = (r: {
    athleteId: string;
    weapon: string;
    gender: string;
    category: string;
  }) => `${r.athleteId}|${r.weapon}|${r.gender}|${r.category}`;

  const antes = new Map(previos.map((p) => [clave(p), p.position]));

  return actuales
    .map((r) => {
      const previa = antes.get(clave(r));
      return {
        athleteId: r.athleteId,
        weapon: r.weapon,
        gender: r.gender,
        category: r.category,
        position: r.position,
        totalPoints: Number.parseFloat(r.totalPoints),
        pruebasContadas: Array.isArray(r.countedEventIds)
          ? r.countedEventIds.length
          : 0,
        // Subir en el ranking es bajar de número: se invierte el signo para
        // que "+2" signifique lo que la gente espera.
        variacion: previa === undefined ? null : previa - r.position,
        calculadoEl: ultimo,
      };
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * Puntos que sacó cada tirador en cada prueba, indexados por
 * `athleteId|eventCompetitionId`. Es lo que permite cerrar el círculo en una
 * competición ya celebrada: qué puesto hizo y qué le dejó en el ranking.
 */
export async function getPuntosPorPrueba(
  athleteIds: string[],
): Promise<Record<string, PuntosDePrueba>> {
  if (athleteIds.length === 0) return {};

  const filas = await db
    .select({
      athleteId: rankingPoint.athleteId,
      eventCompetitionId: rankingPoint.eventCompetitionId,
      position: rankingPoint.position,
      finalPoints: rankingPoint.finalPoints,
      counted: rankingPoint.counted,
      explanation: rankingPoint.explanation,
    })
    .from(rankingPoint)
    .where(inArray(rankingPoint.athleteId, athleteIds));

  const salida: Record<string, PuntosDePrueba> = {};
  for (const f of filas) {
    salida[`${f.athleteId}|${f.eventCompetitionId}`] = {
      position: f.position,
      finalPoints: Number.parseFloat(f.finalPoints),
      cuenta: f.counted === '1',
      explicacion: f.explanation,
    };
  }
  return salida;
}
