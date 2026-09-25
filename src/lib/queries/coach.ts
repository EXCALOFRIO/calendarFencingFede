import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  athlete,
  athleteWeapon,
  club,
  entry,
  event,
  eventCompetition,
  result,
} from '@/db/schema';
import type { Weapon } from '../auth/session';
import type { CategoryCode, SeasonCategoryRow } from '../categories';
import { deriveCategoriesFromBirthDate } from '../categories';
import type { EntryStatus } from '../entries/state-machine';

export type AthleteOverview = {
  id: string;
  fullName: string;
  birthDate: string;
  gender: 'M' | 'F' | 'MIXTO';
  clubName: string | null;
  rfeeLicense: string | null;
  weapons: Weapon[];
  category: CategoryCode | null;
  /** Avisos: licencia caducada, sin licencia, consentimiento sin firmar. */
  warnings: string[];
  /** Nº de inscripciones vivas y en qué punto está la más atrasada. */
  liveEntries: number;
  pendingAtClub: number;
  /** Últimos resultados, de más reciente a más antiguo. */
  recentResults: {
    eventName: string;
    date: string;
    weapon: Weapon;
    category: string;
    position: number;
  }[];
  bestPosition: number | null;
  resultCount: number;
  /** Próxima competición a la que va. */
  nextEvent: { name: string; date: string; city: string | null } | null;
  /**
   * Todas las competiciones futuras a las que va, no solo la siguiente.
   *
   * Es lo que permite darle la vuelta a la lista y enseñarla por competición:
   * la pregunta del seleccionador nacional no es solo "cómo va Fulano", es
   * "quiénes de los míos van al Cto. de Europa".
   */
  upcoming: {
    eventId: string;
    name: string;
    date: string;
    city: string | null;
    weapon: Weapon;
    category: string;
  }[];
};

/**
 * Tiradores que ve un seleccionador.
 *
 * `weapons` vacío significa "todas": es lo que pasa con un administrador, y
 * también cuando el seleccionador pulsa "ver todas las armas". La app no le
 * esconde nada a nadie; lo que hace es enseñarle primero lo suyo.
 *
 * Se resuelve en cinco consultas y se cose en memoria, no una por tirador:
 * cada consulta a Neon es un viaje de red, y con 60 tiradores un bucle serían
 * 300 viajes.
 */
export async function getAthleteOverview(
  weapons: Weapon[],
  seasonCategories: SeasonCategoryRow[],
): Promise<AthleteOverview[]> {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Tiradores, filtrados por arma si procede.
  let athleteIds: string[] | null = null;
  if (weapons.length > 0) {
    const rows = await db
      .selectDistinct({ athleteId: athleteWeapon.athleteId })
      .from(athleteWeapon)
      .where(inArray(athleteWeapon.weapon, weapons));
    athleteIds = rows.map((r) => r.athleteId);
    if (athleteIds.length === 0) return [];
  }

  const atletas = await db
    .select({
      id: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      birthDate: athlete.birthDate,
      gender: athlete.gender,
      clubName: club.name,
      rfeeLicense: athlete.rfeeLicense,
      rfeeLicenseValidUntil: athlete.rfeeLicenseValidUntil,
      fieLicenseValidUntil: athlete.fieLicenseValidUntil,
      consentSignedAt: athlete.consentSignedAt,
    })
    .from(athlete)
    .leftJoin(club, eq(athlete.clubId, club.id))
    .where(
      athleteIds
        ? and(eq(athlete.active, true), inArray(athlete.id, athleteIds))
        : eq(athlete.active, true),
    )
    .orderBy(asc(athlete.lastName), asc(athlete.firstName));

  if (atletas.length === 0) return [];

  const ids = atletas.map((a) => a.id);

  // 2-5. Armas, inscripciones vivas, próximos eventos y resultados.
  const [armas, inscripciones, proximos, resultados] = await Promise.all([
    db
      .select({ athleteId: athleteWeapon.athleteId, weapon: athleteWeapon.weapon })
      .from(athleteWeapon)
      .where(inArray(athleteWeapon.athleteId, ids)),

    db
      .select({ athleteId: entry.athleteId, status: entry.status })
      .from(entry)
      .where(
        and(
          inArray(entry.athleteId, ids),
          inArray(entry.status, [
            'pending_club',
            'club_approved',
            'federation_approved',
            'submitted',
          ]),
        ),
      ),

    db
      .select({
        athleteId: entry.athleteId,
        eventId: event.id,
        name: event.name,
        date: event.startDate,
        city: event.city,
        weapon: eventCompetition.weapon,
        category: eventCompetition.category,
      })
      .from(entry)
      .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
      .innerJoin(event, eq(eventCompetition.eventId, event.id))
      .where(
        and(
          inArray(entry.athleteId, ids),
          gte(event.startDate, today),
          inArray(entry.status, ['federation_approved', 'submitted', 'club_approved']),
        ),
      )
      .orderBy(asc(event.startDate)),

    db
      .select({
        athleteId: result.athleteId,
        eventName: event.name,
        date: event.startDate,
        weapon: eventCompetition.weapon,
        category: eventCompetition.category,
        position: result.position,
      })
      .from(result)
      .innerJoin(eventCompetition, eq(result.eventCompetitionId, eventCompetition.id))
      .innerJoin(event, eq(eventCompetition.eventId, event.id))
      .where(inArray(result.athleteId, ids))
      .orderBy(desc(event.startDate))
      .limit(500),
  ]);

  const armasPorAtleta = new Map<string, Weapon[]>();
  for (const a of armas) {
    const lista = armasPorAtleta.get(a.athleteId) ?? [];
    lista.push(a.weapon);
    armasPorAtleta.set(a.athleteId, lista);
  }

  const vivasPorAtleta = new Map<string, EntryStatus[]>();
  for (const i of inscripciones) {
    const lista = vivasPorAtleta.get(i.athleteId) ?? [];
    lista.push(i.status as EntryStatus);
    vivasPorAtleta.set(i.athleteId, lista);
  }

  const proximoPorAtleta = new Map<string, (typeof proximos)[number]>();
  const proximasPorAtleta = new Map<string, typeof proximos>();
  for (const p of proximos) {
    if (!proximoPorAtleta.has(p.athleteId)) proximoPorAtleta.set(p.athleteId, p);
    const lista = proximasPorAtleta.get(p.athleteId) ?? [];
    lista.push(p);
    proximasPorAtleta.set(p.athleteId, lista);
  }

  const resultadosPorAtleta = new Map<string, typeof resultados>();
  for (const r of resultados) {
    if (!r.athleteId) continue;
    const lista = resultadosPorAtleta.get(r.athleteId) ?? [];
    lista.push(r);
    resultadosPorAtleta.set(r.athleteId, lista);
  }

  return atletas.map((a) => {
    const vivas = vivasPorAtleta.get(a.id) ?? [];
    const res = resultadosPorAtleta.get(a.id) ?? [];
    const proximo = proximoPorAtleta.get(a.id) ?? null;

    const warnings: string[] = [];
    if (!a.rfeeLicense) warnings.push('Sin licencia RFEE');
    if (a.rfeeLicenseValidUntil && a.rfeeLicenseValidUntil < today) {
      warnings.push('Licencia RFEE caducada');
    }
    if (a.fieLicenseValidUntil && a.fieLicenseValidUntil < today) {
      warnings.push('Licencia FIE caducada');
    }
    if (!a.consentSignedAt) warnings.push('Consentimiento sin firmar');

    const derived =
      seasonCategories.length > 0
        ? deriveCategoriesFromBirthDate(a.birthDate, seasonCategories)
        : null;

    return {
      id: a.id,
      fullName: `${a.firstName} ${a.lastName}`.trim(),
      birthDate: a.birthDate,
      gender: a.gender,
      clubName: a.clubName,
      rfeeLicense: a.rfeeLicense,
      weapons: armasPorAtleta.get(a.id) ?? [],
      category: derived?.own ?? null,
      warnings,
      liveEntries: vivas.length,
      pendingAtClub: vivas.filter((s) => s === 'pending_club').length,
      recentResults: res.slice(0, 5).map((r) => ({
        eventName: r.eventName,
        date: r.date,
        weapon: r.weapon,
        category: r.category,
        position: r.position,
      })),
      bestPosition: res.length > 0 ? Math.min(...res.map((r) => r.position)) : null,
      resultCount: res.length,
      nextEvent: proximo
        ? { name: proximo.name, date: proximo.date, city: proximo.city }
        : null,
      upcoming: (proximasPorAtleta.get(a.id) ?? []).map((p) => ({
        eventId: p.eventId,
        name: p.name,
        date: p.date,
        city: p.city,
        weapon: p.weapon,
        category: p.category,
      })),
    };
  });
}

/** Cuántos tiradores hay por arma. Alimenta el selector de la pantalla. */
export async function countAthletesByWeapon() {
  return db
    .select({
      weapon: athleteWeapon.weapon,
      count: sql<number>`count(distinct ${athleteWeapon.athleteId})::int`,
    })
    .from(athleteWeapon)
    .innerJoin(athlete, eq(athleteWeapon.athleteId, athlete.id))
    .where(eq(athlete.active, true))
    .groupBy(athleteWeapon.weapon);
}
