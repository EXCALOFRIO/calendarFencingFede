import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  athlete,
  callUp,
  callUpAthlete,
  club,
  event,
  eventCompetition,
  rankingRule,
  rankingSnapshot,
  userProfile,
} from '@/db/schema';
import { getCurrentSeason } from './calendar';
import {
  competitionLabel,
  type AthletePicker,
  type CallUpAthleteRow,
  type CallUpDetail,
  type CallUpForAthlete,
  type CallUpStatus,
  type CallUpSummary,
  type EventoConvocable,
  type PlaceType,
  type RankingPrueba,
} from '../callups/tipos';

/**
 * Consultas de convocatorias.
 *
 * Están separadas de las acciones porque las lee un componente de servidor y
 * las acciones escriben: mezclar ambas cosas en un fichero con `'use server'`
 * convertiría cada consulta en un endpoint público sin querer.
 *
 * Los tipos y las etiquetas viven en `src/lib/callups/tipos.ts`, que no toca
 * la base de datos: así los componentes de cliente pueden importarlos sin
 * arrastrar el módulo de conexión al navegador.
 */

export {
  CALL_UP_STATUS_LABEL,
  PLACE_TYPE_LABEL,
  competitionLabel,
} from '../callups/tipos';
export type {
  AthletePicker,
  CallUpAthleteRow,
  CallUpDetail,
  CallUpForAthlete,
  CallUpStatus,
  CallUpSummary,
  CandidatoRanking,
  EventoConvocable,
  PlaceType,
  RankingPrueba,
} from '../callups/tipos';

/**
 * Convocatorias PUBLICADAS que afectan a los tiradores de esta cuenta.
 *
 * Solo publicadas: un borrador que el seleccionador está preparando no debe
 * verse desde fuera bajo ningún concepto.
 */
export async function listCallUpsForAthletes(
  athleteIds: string[],
): Promise<CallUpForAthlete[]> {
  if (athleteIds.length === 0) return [];

  const rows = await db
    .select({
      id: callUpAthlete.id,
      callUpId: callUp.id,
      title: callUp.title,
      body: callUp.body,
      pdfUrl: callUp.pdfUrl,
      pdfName: callUp.pdfName,
      travelNotes: callUp.travelNotes,
      publishedAt: callUp.publishedAt,
      callUpRespondBy: callUp.respondBy,
      eventId: event.id,
      eventName: event.name,
      eventStartDate: event.startDate,
      eventEndDate: event.endDate,
      eventCity: event.city,
      eventCountry: event.country,
      eventSourceUrl: event.sourceUrl,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
      placeType: callUpAthlete.placeType,
      rankingPositionAtCutoff: callUpAthlete.rankingPositionAtCutoff,
      status: callUpAthlete.status,
      rowRespondBy: callUpAthlete.respondBy,
      respondedAt: callUpAthlete.respondedAt,
      rejectionReason: callUpAthlete.rejectionReason,
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
    })
    .from(callUpAthlete)
    .innerJoin(callUp, eq(callUpAthlete.callUpId, callUp.id))
    .innerJoin(event, eq(callUp.eventId, event.id))
    .innerJoin(athlete, eq(callUpAthlete.athleteId, athlete.id))
    .leftJoin(
      eventCompetition,
      eq(callUpAthlete.eventCompetitionId, eventCompetition.id),
    )
    .where(
      and(eq(callUp.published, true), inArray(callUpAthlete.athleteId, athleteIds)),
    )
    .orderBy(asc(event.startDate));

  return rows.map((r) => ({
    id: r.id,
    callUpId: r.callUpId,
    title: r.title,
    body: r.body,
    pdfUrl: r.pdfUrl,
    pdfName: r.pdfName,
    travelNotes: r.travelNotes,
    publishedAt: r.publishedAt,
    eventId: r.eventId,
    eventName: r.eventName,
    eventStartDate: r.eventStartDate,
    eventEndDate: r.eventEndDate,
    eventCity: r.eventCity,
    eventCountry: r.eventCountry,
    eventSourceUrl: r.eventSourceUrl,
    competition: r.weapon
      ? competitionLabel({
          weapon: r.weapon,
          gender: r.gender!,
          category: r.category!,
          format: r.format,
        })
      : null,
    placeType: r.placeType as PlaceType,
    rankingPositionAtCutoff: r.rankingPositionAtCutoff,
    status: r.status as CallUpStatus,
    // El plazo de la fila manda sobre el general: a veces a un tirador se le
    // da menos margen porque el vuelo se cierra antes.
    respondBy: r.rowRespondBy ?? r.callUpRespondBy,
    respondedAt: r.respondedAt,
    rejectionReason: r.rejectionReason,
    athleteId: r.athleteId,
    athleteName: `${r.firstName} ${r.lastName}`.trim(),
  }));
}

/** Listado del panel de administración, con el recuento de respuestas. */
export async function listCallUpsForAdmin(): Promise<CallUpSummary[]> {
  const rows = await db
    .select({
      id: callUp.id,
      title: callUp.title,
      published: callUp.published,
      publishedAt: callUp.publishedAt,
      respondBy: callUp.respondBy,
      pdfUrl: callUp.pdfUrl,
      pdfName: callUp.pdfName,
      createdAt: callUp.createdAt,
      eventId: event.id,
      eventName: event.name,
      eventStartDate: event.startDate,
      eventEndDate: event.endDate,
      eventCity: event.city,
    })
    .from(callUp)
    .innerJoin(event, eq(callUp.eventId, event.id))
    .orderBy(desc(callUp.createdAt));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      callUpId: callUpAthlete.callUpId,
      status: callUpAthlete.status,
      n: sql<number>`count(*)::int`,
    })
    .from(callUpAthlete)
    .where(
      inArray(
        callUpAthlete.callUpId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(callUpAthlete.callUpId, callUpAthlete.status);

  return rows.map((r) => {
    const propias = counts.filter((c) => c.callUpId === r.id);
    const byStatus = (s: CallUpStatus) =>
      propias.find((c) => c.status === s)?.n ?? 0;
    return {
      ...r,
      total: propias.reduce((acc, c) => acc + c.n, 0),
      confirmados: byStatus('confirmado'),
      rechazados: byStatus('rechazado'),
      pendientes: byStatus('pendiente'),
    };
  });
}

export async function getCallUpDetail(callUpId: string): Promise<CallUpDetail | null> {
  const [row] = await db
    .select({
      id: callUp.id,
      title: callUp.title,
      body: callUp.body,
      travelNotes: callUp.travelNotes,
      published: callUp.published,
      publishedAt: callUp.publishedAt,
      respondBy: callUp.respondBy,
      pdfUrl: callUp.pdfUrl,
      pdfName: callUp.pdfName,
      createdAt: callUp.createdAt,
      createdByName: userProfile.fullName,
      eventId: event.id,
      eventName: event.name,
      eventStartDate: event.startDate,
      eventEndDate: event.endDate,
      eventCity: event.city,
    })
    .from(callUp)
    .innerJoin(event, eq(callUp.eventId, event.id))
    .leftJoin(userProfile, eq(callUp.createdByProfileId, userProfile.id))
    .where(eq(callUp.id, callUpId))
    .limit(1);

  if (!row) return null;

  const convocados = await db
    .select({
      id: callUpAthlete.id,
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      clubName: club.name,
      rfeeLicense: athlete.rfeeLicense,
      eventCompetitionId: callUpAthlete.eventCompetitionId,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
      placeType: callUpAthlete.placeType,
      rankingPositionAtCutoff: callUpAthlete.rankingPositionAtCutoff,
      status: callUpAthlete.status,
      rejectionReason: callUpAthlete.rejectionReason,
      respondedAt: callUpAthlete.respondedAt,
    })
    .from(callUpAthlete)
    .innerJoin(athlete, eq(callUpAthlete.athleteId, athlete.id))
    .leftJoin(club, eq(athlete.clubId, club.id))
    .leftJoin(
      eventCompetition,
      eq(callUpAthlete.eventCompetitionId, eventCompetition.id),
    )
    .where(eq(callUpAthlete.callUpId, callUpId))
    .orderBy(asc(callUpAthlete.rankingPositionAtCutoff), asc(athlete.lastName));

  const filas: CallUpAthleteRow[] = convocados.map((c) => ({
    id: c.id,
    athleteId: c.athleteId,
    athleteName: `${c.firstName} ${c.lastName}`.trim(),
    clubName: c.clubName,
    rfeeLicense: c.rfeeLicense,
    eventCompetitionId: c.eventCompetitionId,
    competition: c.weapon
      ? competitionLabel({
          weapon: c.weapon,
          gender: c.gender!,
          category: c.category!,
          format: c.format,
        })
      : null,
    placeType: c.placeType as PlaceType,
    rankingPositionAtCutoff: c.rankingPositionAtCutoff,
    status: c.status as CallUpStatus,
    rejectionReason: c.rejectionReason,
    respondedAt: c.respondedAt,
  }));

  const cuenta = (s: CallUpStatus) => filas.filter((f) => f.status === s).length;

  return {
    ...row,
    total: filas.length,
    confirmados: cuenta('confirmado'),
    rechazados: cuenta('rechazado'),
    pendientes: cuenta('pendiente'),
    convocados: filas,
  };
}

/**
 * Eventos futuros a los que tiene sentido convocar. No se listan los pasados:
 * convocar a algo que ya se ha celebrado no existe.
 */
export async function listEventosConvocables(): Promise<EventoConvocable[]> {
  const hoy = new Date().toISOString().slice(0, 10);

  const eventos = await db
    .select({
      id: event.id,
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      city: event.city,
      scope: event.scope,
    })
    .from(event)
    .where(
      and(
        isNull(event.disappearedAt),
        eq(event.cancelled, false),
        sql`${event.endDate} >= ${hoy}`,
      ),
    )
    .orderBy(asc(event.startDate))
    .limit(300);

  if (eventos.length === 0) return [];

  const pruebas = await db
    .select({
      id: eventCompetition.id,
      eventId: eventCompetition.eventId,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
    })
    .from(eventCompetition)
    .where(
      inArray(
        eventCompetition.eventId,
        eventos.map((e) => e.id),
      ),
    );

  return eventos.map((e) => ({
    ...e,
    competitions: pruebas
      .filter((p) => p.eventId === e.id)
      .map((p) => ({
        id: p.id,
        weapon: p.weapon,
        gender: p.gender,
        category: p.category,
        format: p.format,
        label: competitionLabel(p),
      })),
  }));
}

/**
 * Orden por ranking interno para cada prueba de un evento.
 *
 * Si no hay snapshot para esa combinación de arma/género/categoría se devuelve
 * `null` en vez de una lista inventada: la pantalla lo dice con todas las
 * letras ("falta calcular el ranking") y el seleccionador elige a mano.
 */
export async function getRankingParaEvento(eventId: string): Promise<{
  pruebas: RankingPrueba[];
  seasonLabel: string | null;
}> {
  const temporada = await getCurrentSeason();

  const pruebas = await db
    .select({
      id: eventCompetition.id,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
    })
    .from(eventCompetition)
    .where(eq(eventCompetition.eventId, eventId))
    .orderBy(asc(eventCompetition.weapon), asc(eventCompetition.category));

  if (!temporada || pruebas.length === 0) {
    return {
      seasonLabel: temporada?.label ?? null,
      pruebas: pruebas.map((p) => ({
        eventCompetitionId: p.id,
        label: competitionLabel(p),
        candidatos: null,
        computedAt: null,
        rankingPlaces: null,
        technicalPlaces: null,
        cutoffDate: null,
      })),
    };
  }

  const [snapshots, reglas] = await Promise.all([
    db
      .select({
        weapon: rankingSnapshot.weapon,
        gender: rankingSnapshot.gender,
        category: rankingSnapshot.category,
        position: rankingSnapshot.position,
        totalPoints: rankingSnapshot.totalPoints,
        computedAt: rankingSnapshot.computedAt,
        athleteId: athlete.id,
        firstName: athlete.firstName,
        lastName: athlete.lastName,
        clubName: club.name,
        rfeeLicense: athlete.rfeeLicense,
      })
      .from(rankingSnapshot)
      .innerJoin(athlete, eq(rankingSnapshot.athleteId, athlete.id))
      .leftJoin(club, eq(athlete.clubId, club.id))
      .where(eq(rankingSnapshot.seasonId, temporada.id))
      .orderBy(asc(rankingSnapshot.position)),
    db
      .select()
      .from(rankingRule)
      .where(and(eq(rankingRule.seasonId, temporada.id), eq(rankingRule.active, true))),
  ]);

  return {
    seasonLabel: temporada.label,
    pruebas: pruebas.map((p) => {
      const delGrupo = snapshots.filter(
        (s) =>
          s.weapon === p.weapon && s.gender === p.gender && s.category === p.category,
      );

      // Puede haber varios cortes guardados; solo vale el más reciente.
      const ultimo = delGrupo.reduce<Date | null>(
        (acc, s) => (!acc || s.computedAt > acc ? s.computedAt : acc),
        null,
      );
      const vigentes = ultimo
        ? delGrupo.filter((s) => s.computedAt.getTime() === ultimo.getTime())
        : [];

      // Regla más específica primero: arma+categoría gana a la genérica.
      const regla =
        reglas.find((r) => r.weapon === p.weapon && r.category === p.category) ??
        reglas.find((r) => r.weapon === p.weapon && r.category === null) ??
        reglas.find((r) => r.weapon === null && r.category === p.category) ??
        reglas.find((r) => r.weapon === null && r.category === null) ??
        null;

      return {
        eventCompetitionId: p.id,
        label: competitionLabel(p),
        candidatos:
          vigentes.length === 0
            ? null
            : vigentes
                .sort((a, b) => a.position - b.position)
                .map((s) => ({
                  athleteId: s.athleteId,
                  athleteName: `${s.firstName} ${s.lastName}`.trim(),
                  clubName: s.clubName,
                  rfeeLicense: s.rfeeLicense,
                  position: s.position,
                  totalPoints: s.totalPoints,
                })),
        computedAt: ultimo,
        rankingPlaces: regla?.rankingPlaces ?? null,
        technicalPlaces: regla?.technicalPlaces ?? null,
        cutoffDate: regla?.cutoffDate ?? null,
      };
    }),
  };
}

/** Tiradores activos, para las plazas de criterio técnico (elección manual). */
export async function listAthletesForPicker(): Promise<AthletePicker[]> {
  const rows = await db
    .select({
      id: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      clubName: club.name,
      rfeeLicense: athlete.rfeeLicense,
      birthDate: athlete.birthDate,
      gender: athlete.gender,
    })
    .from(athlete)
    .leftJoin(club, eq(athlete.clubId, club.id))
    .where(eq(athlete.active, true))
    .orderBy(asc(athlete.lastName), asc(athlete.firstName));

  return rows.map((r) => ({
    id: r.id,
    name: `${r.lastName}, ${r.firstName}`.trim(),
    clubName: r.clubName,
    rfeeLicense: r.rfeeLicense,
    birthDate: r.birthDate,
    gender: r.gender,
  }));
}
