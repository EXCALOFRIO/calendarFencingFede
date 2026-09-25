import { and, asc, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  athlete,
  callUp,
  callUpAthlete,
  entry,
  event,
  eventCompetition,
  eventDeadline,
  result,
} from '@/db/schema';
import { type AthleteSummary, getManagedAthletes } from '../auth/session';
import { deriveCategoriesFromBirthDate } from '../categories';
import {
  type ComputedDeadline,
  computeDeadlines,
  deadlineStatus,
  mergeDeadlines,
} from '../deadlines';
import type { EntryStatus } from '../entries/state-machine';
import { waitingOn } from '../entries/state-machine';
import { getCurrentSeason, getDeadlineRules } from './calendar';

export type PendingItem = {
  /** Qué le falta y adónde tiene que ir para arreglarlo. */
  label: string;
  detail: string;
  href: string;
};

export type MyEntry = {
  entryId: string;
  status: EntryStatus;
  waitingOn: string | null;
  since: Date | null;
  reason: string | null;
  athleteId: string;
  athleteName: string;
  eventId: string;
  /**
   * Prueba concreta (`event_competition`), no solo el evento. Hace falta para
   * poder cruzar la inscripción con los puntos de ranking de ESA prueba, que
   * es lo que responde "¿cuánto me movió esta competición?".
   */
  eventCompetitionId: string;
  eventName: string;
  startDate: string;
  endDate: string;
  city: string | null;
  country: string | null;
  timezone: string | null;
  venue: string | null;
  venueAddress: string | null;
  geoLat: string | null;
  geoLon: string | null;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  format: 'INDIVIDUAL' | 'EQUIPOS';
  callTime: string | null;
  startTime: string | null;
  installationOpen: string | null;
  scratchTime: string | null;
  deadlines: ComputedDeadline[];
  deadlineStatus: ReturnType<typeof deadlineStatus>;
  /** Resultado, cuando la competición ya pasó. */
  resultPosition: number | null;
  resultPoints: string | null;
};

export type MyCallUp = {
  id: string;
  callUpId: string;
  title: string;
  eventName: string;
  startDate: string;
  /** A quién se convoca. El id, no solo el nombre: la cuenta de un tutor
   *  filtra por tirador y dos hermanos pueden llamarse casi igual. */
  athleteId: string;
  athleteName: string;
  placeType: 'ranking' | 'tecnica';
  status: 'pendiente' | 'confirmado' | 'rechazado';
  respondBy: Date | null;
  pdfUrl: string | null;
};

export type MyStatus = {
  athletes: (AthleteSummary & {
    ownCategory: string | null;
    eligibleCategories: string[];
    categoryExplanation: string;
    pending: PendingItem[];
  })[];
  entries: MyEntry[];
  upcomingEntries: MyEntry[];
  pastEntries: MyEntry[];
  callUps: MyCallUp[];
  /** Competiciones que son HOY: el panel del día de competición. */
  today: MyEntry[];
};

/**
 * Todo lo que necesita la pantalla "Mi estado".
 *
 * Es la primera que se ve al entrar y la razón de ser de la app: responde de
 * un vistazo a "¿cómo va mi inscripción?", "¿en quién está la pelota?",
 * "¿cuánto me queda de plazo?" y "¿qué me falta?", que hoy solo se responden
 * llamando por teléfono.
 */
export async function getMyStatus(profileId: string): Promise<MyStatus> {
  const managed = await getManagedAthletes(profileId);
  const current = await getCurrentSeason();
  const rules = await getDeadlineRules();

  const athletes = managed.map((a) => {
    const derived = current
      ? deriveCategoriesFromBirthDate(a.birthDate, current.categories)
      : {
          own: null,
          eligible: [],
          explanation:
            'Todavía no hay temporada configurada, así que no se puede ' +
            'calcular tu categoría. Un administrador tiene que crearla.',
        };

    return {
      ...a,
      ownCategory: derived.own,
      eligibleCategories: derived.eligible,
      categoryExplanation: derived.explanation,
      pending: pendingFor(a),
    };
  });

  if (managed.length === 0) {
    return {
      athletes,
      entries: [],
      upcomingEntries: [],
      pastEntries: [],
      callUps: [],
      today: [],
    };
  }

  const athleteIds = managed.map((a) => a.id);
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      entryId: entry.id,
      status: entry.status,
      requestedAt: entry.requestedAt,
      clubDecidedAt: entry.clubDecidedAt,
      federationDecidedAt: entry.federationDecidedAt,
      submittedAt: entry.submittedAt,
      reason: entry.reason,
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      eventId: event.id,
      eventName: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      city: event.city,
      country: event.country,
      timezone: event.timezone,
      venue: event.venue,
      venueAddress: event.venueAddress,
      geoLat: event.geoLat,
      geoLon: event.geoLon,
      circuit: event.circuit,
      scope: event.scope,
      competitionId: eventCompetition.id,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
      callTime: eventCompetition.callTime,
      startTime: eventCompetition.startTime,
      installationOpen: eventCompetition.installationOpen,
      scratchTime: eventCompetition.scratchTime,
    })
    .from(entry)
    .innerJoin(athlete, eq(entry.athleteId, athlete.id))
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(inArray(entry.athleteId, athleteIds))
    .orderBy(asc(event.startDate));

  const competitionIds = rows.map((r) => r.competitionId);

  // Plazos publicados y resultados, en una consulta cada uno.
  const [publishedDeadlines, results] = await Promise.all([
    competitionIds.length > 0
      ? db
          .select()
          .from(eventDeadline)
          .where(inArray(eventDeadline.eventCompetitionId, competitionIds))
      : Promise.resolve([]),
    competitionIds.length > 0
      ? db
          .select({
            competitionId: result.eventCompetitionId,
            athleteId: result.athleteId,
            position: result.position,
            points: result.officialPoints,
          })
          .from(result)
          .where(
            and(
              inArray(result.eventCompetitionId, competitionIds),
              inArray(result.athleteId, athleteIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const deadlinesByCompetition = new Map<string, ComputedDeadline[]>();
  for (const d of publishedDeadlines) {
    if (!d.eventCompetitionId) continue;
    const list = deadlinesByCompetition.get(d.eventCompetitionId) ?? [];
    list.push({
      type: d.type,
      label: d.type === 'L1' ? 'Cierre de inscripción' : `Plazo ${d.type}`,
      deadlineAt: d.deadlineAt,
      surchargeEur: d.surchargeEur,
      blocking: d.blocking,
      origin: d.origin,
      sourceDocument: d.sourceDocument,
      sourceUrl: d.sourceUrl,
    });
    deadlinesByCompetition.set(d.eventCompetitionId, list);
  }

  const resultByKey = new Map<string, { position: number; points: string | null }>();
  for (const r of results) {
    if (!r.competitionId || !r.athleteId) continue;
    resultByKey.set(`${r.competitionId}|${r.athleteId}`, {
      position: r.position,
      points: r.points,
    });
  }

  const now = new Date();

  const entries: MyEntry[] = rows.map((r) => {
    const published = deadlinesByCompetition.get(r.competitionId) ?? [];
    const calculated = computeDeadlines(r.startDate, rules, {
      scope: r.scope as 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO',
      circuit: r.circuit,
      category: r.category as never,
    });
    const merged = mergeDeadlines(published, calculated);
    const res = resultByKey.get(`${r.competitionId}|${r.athleteId}`);

    return {
      entryId: r.entryId,
      status: r.status as EntryStatus,
      waitingOn: waitingOn(r.status as EntryStatus),
      since:
        r.federationDecidedAt ?? r.clubDecidedAt ?? r.requestedAt ?? null,
      reason: r.reason,
      athleteId: r.athleteId,
      athleteName: `${r.firstName} ${r.lastName}`.trim(),
      eventId: r.eventId,
      eventCompetitionId: r.competitionId,
      eventName: r.eventName,
      startDate: r.startDate,
      endDate: r.endDate,
      city: r.city,
      country: r.country,
      timezone: r.timezone,
      venue: r.venue,
      venueAddress: r.venueAddress,
      geoLat: r.geoLat,
      geoLon: r.geoLon,
      weapon: r.weapon,
      gender: r.gender,
      category: r.category,
      format: r.format,
      callTime: r.callTime,
      startTime: r.startTime,
      installationOpen: r.installationOpen,
      scratchTime: r.scratchTime,
      deadlines: merged,
      deadlineStatus: deadlineStatus(merged, now),
      resultPosition: res?.position ?? null,
      resultPoints: res?.points ?? null,
    };
  });

  const callUpRows = await db
    .select({
      id: callUpAthlete.id,
      callUpId: callUp.id,
      title: callUp.title,
      eventName: event.name,
      startDate: event.startDate,
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      placeType: callUpAthlete.placeType,
      status: callUpAthlete.status,
      respondBy: callUpAthlete.respondBy,
      pdfUrl: callUp.pdfUrl,
    })
    .from(callUpAthlete)
    .innerJoin(callUp, eq(callUpAthlete.callUpId, callUp.id))
    .innerJoin(event, eq(callUp.eventId, event.id))
    .innerJoin(athlete, eq(callUpAthlete.athleteId, athlete.id))
    .where(and(inArray(callUpAthlete.athleteId, athleteIds), eq(callUp.published, true)))
    .orderBy(desc(callUp.publishedAt));

  return {
    athletes,
    entries,
    upcomingEntries: entries.filter((e) => e.endDate >= today),
    pastEntries: entries.filter((e) => e.endDate < today).reverse(),
    today: entries.filter((e) => e.startDate <= today && e.endDate >= today),
    callUps: callUpRows.map((c) => ({
      id: c.id,
      callUpId: c.callUpId,
      title: c.title,
      eventName: c.eventName,
      startDate: c.startDate,
      athleteId: c.athleteId,
      athleteName: `${c.firstName} ${c.lastName}`.trim(),
      placeType: c.placeType,
      status: c.status,
      respondBy: c.respondBy,
      pdfUrl: c.pdfUrl,
    })),
  };
}

/**
 * Qué le falta al tirador para poder competir.
 *
 * Se da siempre con el enlace para arreglarlo, no solo el aviso: un mensaje
 * que dice "te falta la licencia" y no dice dónde se arregla no sirve.
 */
function pendingFor(a: AthleteSummary): PendingItem[] {
  const items: PendingItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  if (!a.rfeeLicense) {
    items.push({
      label: 'Falta el número de licencia RFEE',
      detail:
        'Sin él no se pueden emparejar tus resultados ni calcular tu ranking.',
      href: '/perfil',
    });
  }

  if (a.rfeeLicenseValidUntil && a.rfeeLicenseValidUntil < today) {
    items.push({
      label: 'Licencia RFEE caducada',
      detail: `Caducó el ${a.rfeeLicenseValidUntil}. Renuévala en tu club.`,
      href: '/perfil',
    });
  }

  if (a.fieLicenseValidUntil && a.fieLicenseValidUntil < today) {
    items.push({
      label: 'Licencia FIE caducada',
      detail: `Caducó el ${a.fieLicenseValidUntil}. Sin ella no puedes competir fuera.`,
      href: '/perfil',
    });
  }

  if (!a.consentSignedAt) {
    items.push({
      label: 'Consentimiento sin firmar',
      detail:
        'Hace falta el consentimiento de tratamiento de datos (lo firma el ' +
        'tutor si el tirador es menor).',
      href: '/perfil',
    });
  }

  if (a.weapons.length === 0) {
    items.push({
      label: 'No tienes ningún arma asignada',
      detail: 'Sin arma no se puede filtrar el calendario por lo tuyo.',
      href: '/perfil',
    });
  }

  return items;
}

/** Bandeja del club: solicitudes pendientes de sus tiradores. */
export async function getClubInbox(clubId: string) {
  return db
    .select({
      entryId: entry.id,
      status: entry.status,
      requestedAt: entry.requestedAt,
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      rfeeLicense: athlete.rfeeLicense,
      eventName: event.name,
      startDate: event.startDate,
      city: event.city,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
    })
    .from(entry)
    .innerJoin(athlete, eq(entry.athleteId, athlete.id))
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(
      and(
        eq(athlete.clubId, clubId),
        inArray(entry.status, ['pending_club', 'club_approved']),
      ),
    )
    .orderBy(asc(event.startDate));
}

/**
 * Estadísticas de los tiradores de un club o de toda la federación.
 * Alimenta el panel del seleccionador.
 */
export async function getAthleteStats(clubId?: string | null) {
  const rows = await db
    .select({
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      weapon: eventCompetition.weapon,
      category: eventCompetition.category,
      position: result.position,
      points: result.officialPoints,
      eventName: event.name,
      startDate: event.startDate,
    })
    .from(result)
    .innerJoin(athlete, eq(result.athleteId, athlete.id))
    .innerJoin(eventCompetition, eq(result.eventCompetitionId, eventCompetition.id))
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(clubId ? eq(athlete.clubId, clubId) : undefined)
    .orderBy(desc(event.startDate))
    .limit(500);

  return rows;
}

/** Competiciones de hoy de los tiradores de un club (panel del día). */
export async function getTodayForClub(clubId: string) {
  const today = new Date().toISOString().slice(0, 10);

  return db
    .select({
      athleteName: athlete.firstName,
      athleteSurname: athlete.lastName,
      eventName: event.name,
      city: event.city,
      venue: event.venue,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
      installationOpen: eventCompetition.installationOpen,
      callTime: eventCompetition.callTime,
      scratchTime: eventCompetition.scratchTime,
      startTime: eventCompetition.startTime,
      status: entry.status,
      eventId: event.id,
    })
    .from(entry)
    .innerJoin(athlete, eq(entry.athleteId, athlete.id))
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(
      and(
        eq(athlete.clubId, clubId),
        or(eq(entry.status, 'submitted'), eq(entry.status, 'federation_approved')),
        gte(event.endDate, today),
      ),
    )
    .orderBy(asc(event.startDate))
    .limit(100);
}
