import { and, desc, eq, gte, inArray, isNull, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  entry,
  event,
  eventCompetition,
  eventDeadline,
  rankingPoint,
  rankingSnapshot,
  season,
} from '@/db/schema';
import type { CategoryCode } from '@/lib/categories';
import {
  type ComputedDeadline,
  computeDeadlines,
  deadlineStatus,
  mergeDeadlines,
} from '@/lib/deadlines';
import { getDeadlineRules } from '@/lib/queries/calendar';

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

/**
 * Una prueba a la que el tirador PUEDE apuntarse y todavía no se ha apuntado.
 *
 * Es la pieza que faltaba: la aplicación sabía decir cómo iban las
 * inscripciones pedidas, pero no en cuáles no estabas. Alguien que se entera
 * tarde de una convocatoria abierta no tiene ningún sitio donde enterarse
 * pronto, y ese es justo el problema que se venía resolviendo por WhatsApp.
 */
export type CompeticionElegible = {
  competitionId: string;
  eventId: string;
  eventName: string;
  startDate: string;
  endDate: string;
  city: string | null;
  country: string | null;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  feeEur: string | null;
  athleteId: string;
  athleteName: string;
  /** Días hasta el cierre. Nunca `null`: sin plazo abierto no sale aquí. */
  diasRestantes: number;
  /** Semáforo, tal y como lo calcula `deadlines.ts` y nadie más. */
  estado: ReturnType<typeof deadlineStatus>;
};

/** Lo que hay que saber de un tirador para decidir qué le corresponde. */
export type TiradorElegibilidad = {
  id: string;
  fullName: string;
  gender: 'M' | 'F' | 'MIXTO';
  weapons: ('FLORETE' | 'ESPADA' | 'SABLE')[];
  eligibleCategories: string[];
};

/**
 * Pruebas abiertas para las que el tirador es elegible y no tiene solicitud.
 *
 * La elegibilidad es exactamente la misma regla que aplica la ficha del
 * calendario (`ficha-evento.tsx`): su arma, su género y las categorías que le
 * derivó `deriveCategories`. Aquí se comprueba en SQL en lugar de en el
 * cliente porque el candidato no es «las pruebas de este torneo» sino «las de
 * toda la temporada», y eso no se baja al móvil.
 *
 * Solo individuales: a una prueba por equipos no se apunta uno solo, y
 * ofrecer el botón sería prometer algo que la federación no tramita así.
 */
export async function getCompeticionesElegibles(
  tiradores: TiradorElegibilidad[],
  /** Cuántas devolver. De un vistazo son unas pocas, no un segundo calendario. */
  tope = 6,
): Promise<CompeticionElegible[]> {
  const conArma = tiradores.filter(
    (t) => t.weapons.length > 0 && t.eligibleCategories.length > 0,
  );
  if (conArma.length === 0) return [];

  const hoy = new Date().toISOString().slice(0, 10);
  const armas = [...new Set(conArma.flatMap((t) => t.weapons))];
  const categorias = [...new Set(conArma.flatMap((t) => t.eligibleCategories))];
  const ids = conArma.map((t) => t.id);

  const [candidatas, yaPedidas, reglas] = await Promise.all([
    db
      .select({
        competitionId: eventCompetition.id,
        weapon: eventCompetition.weapon,
        gender: eventCompetition.gender,
        category: eventCompetition.category,
        feeEur: eventCompetition.feeEur,
        eventId: event.id,
        eventName: event.name,
        startDate: event.startDate,
        endDate: event.endDate,
        city: event.city,
        country: event.country,
        circuit: event.circuit,
        scope: event.scope,
      })
      .from(eventCompetition)
      .innerJoin(event, eq(eventCompetition.eventId, event.id))
      .where(
        and(
          gte(event.startDate, hoy),
          eq(event.cancelled, false),
          isNull(event.disappearedAt),
          // El registro absorbido de la FIE es el MISMO torneo que ya sale por
          // Skermo: contarlo otra vez duplicaría la fila en la lista.
          isNull(event.canonicalEventId),
          eq(eventCompetition.format, 'INDIVIDUAL'),
          inArray(eventCompetition.weapon, armas),
          inArray(eventCompetition.category, categorias as CategoryCode[]),
        ),
      ),
    db
      .select({
        athleteId: entry.athleteId,
        competitionId: entry.eventCompetitionId,
      })
      .from(entry)
      .where(
        and(
          inArray(entry.athleteId, ids),
          // Una retirada o un rechazo dejan la puerta abierta a volver a
          // pedirla: `requestEntry` lo permite, así que aquí también aparece.
          notInArray(entry.status, ['withdrawn', 'rejected']),
        ),
      ),
    getDeadlineRules(),
  ]);

  if (candidatas.length === 0) return [];

  const publicados = await db
    .select()
    .from(eventDeadline)
    .where(
      inArray(
        eventDeadline.eventCompetitionId,
        candidatas.map((c) => c.competitionId),
      ),
    );

  const porPrueba = new Map<string, ComputedDeadline[]>();
  for (const d of publicados) {
    if (!d.eventCompetitionId) continue;
    const lista = porPrueba.get(d.eventCompetitionId) ?? [];
    lista.push({
      type: d.type,
      label: d.type === 'L1' ? 'Cierre de inscripción' : `Plazo ${d.type}`,
      deadlineAt: d.deadlineAt,
      surchargeEur: d.surchargeEur,
      blocking: d.blocking,
      origin: d.origin,
      sourceDocument: d.sourceDocument,
      sourceUrl: d.sourceUrl,
    });
    porPrueba.set(d.eventCompetitionId, lista);
  }

  const ahora = new Date();
  const pedidas = new Set(
    yaPedidas.map((e) => `${e.athleteId}|${e.competitionId}`),
  );

  const salida: CompeticionElegible[] = [];

  for (const c of candidatas) {
    const estado = deadlineStatus(
      mergeDeadlines(
        porPrueba.get(c.competitionId) ?? [],
        computeDeadlines(c.startDate, reglas, {
          scope: c.scope as 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO',
          circuit: c.circuit,
          category: c.category as CategoryCode,
        }),
      ),
      ahora,
    );

    // Sin plazo abierto no hay cuenta atrás que enseñar, y una fila que dice
    // «plazo no publicado» debajo de un titular que promete decirte los días
    // que quedan es peor que no estar.
    if (estado.closed || estado.daysLeft === null) continue;

    for (const t of conArma) {
      if (!t.weapons.includes(c.weapon)) continue;
      if (t.gender !== 'MIXTO' && c.gender !== t.gender) continue;
      if (!t.eligibleCategories.includes(c.category)) continue;
      if (pedidas.has(`${t.id}|${c.competitionId}`)) continue;

      salida.push({
        competitionId: c.competitionId,
        eventId: c.eventId,
        eventName: c.eventName,
        startDate: c.startDate,
        endDate: c.endDate,
        city: c.city,
        country: c.country,
        weapon: c.weapon,
        gender: c.gender,
        category: c.category,
        feeEur: c.feeEur,
        athleteId: t.id,
        athleteName: t.fullName,
        diasRestantes: estado.daysLeft,
        estado,
      });
    }
  }

  // Lo que antes cierra, primero: es el único orden que sirve para decidir.
  return salida
    .sort(
      (a, b) =>
        a.diasRestantes - b.diasRestantes ||
        a.startDate.localeCompare(b.startDate) ||
        a.eventName.localeCompare(b.eventName, 'es'),
    )
    .slice(0, tope);
}
