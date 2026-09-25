import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { entry, event, eventCompetition, rankingSnapshot } from '@/db/schema';
import type { Weapon } from '@/lib/auth/session';

/**
 * Lo que le falta a `src/lib/queries/coach.ts` para esta pantalla.
 *
 * Esa consulta ya trae casi todo en cinco viajes de red, incluido `upcoming[]`
 * con las competiciones a las que va cada tirador. Aquí solo se añaden dos
 * cosas que no están allí y que la pantalla necesita:
 *
 *  1. El puesto en el ranking, que vive en `ranking_snapshot`.
 *  2. Las solicitudes que siguen paradas en el club. `upcoming[]` arranca en
 *     «validada por el club» a propósito, pero para responder «¿quién va al
 *     Cto. de Europa?» hace falta ver también a quien lo ha pedido y todavía
 *     no le han dado el visto bueno: si no, esa persona desaparece de la
 *     lista justo cuando alguien tendría que estar reclamándole al club.
 *
 * Va en un módulo normal, sin `'use server'`: son lecturas para un componente
 * de servidor, no endpoints públicos.
 */

export type PuestoRanking = {
  weapon: Weapon;
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  position: number;
  totalPoints: string;
};

/**
 * Último ranking calculado, por tirador.
 *
 * Solo la foto más reciente: enseñar a la vez el puesto de hoy y el de hace
 * dos meses en la misma columna no aclara nada.
 */
export async function puestosDeRanking(): Promise<Map<string, PuestoRanking[]>> {
  const [ultimo] = await db
    .select({ computedAt: rankingSnapshot.computedAt })
    .from(rankingSnapshot)
    .orderBy(desc(rankingSnapshot.computedAt))
    .limit(1);

  if (!ultimo) return new Map();

  const filas = await db
    .select({
      athleteId: rankingSnapshot.athleteId,
      weapon: rankingSnapshot.weapon,
      gender: rankingSnapshot.gender,
      category: rankingSnapshot.category,
      position: rankingSnapshot.position,
      totalPoints: rankingSnapshot.totalPoints,
    })
    .from(rankingSnapshot)
    .where(eq(rankingSnapshot.computedAt, ultimo.computedAt));

  const mapa = new Map<string, PuestoRanking[]>();
  for (const f of filas) {
    const lista = mapa.get(f.athleteId) ?? [];
    lista.push({
      weapon: f.weapon,
      gender: f.gender,
      category: f.category,
      position: f.position,
      totalPoints: f.totalPoints,
    });
    mapa.set(f.athleteId, lista);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.position - b.position);

  return mapa;
}

export type SolicitudEnClub = {
  athleteId: string;
  eventId: string;
  name: string;
  date: string;
  city: string | null;
  weapon: Weapon;
  category: string;
};

/** Solicitudes de eventos futuros que siguen esperando al club. */
export async function solicitudesEnClub(
  athleteIds: string[],
): Promise<SolicitudEnClub[]> {
  if (athleteIds.length === 0) return [];
  const hoy = new Date().toISOString().slice(0, 10);

  return db
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
        inArray(entry.athleteId, athleteIds),
        eq(entry.status, 'pending_club'),
        gte(event.startDate, hoy),
      ),
    );
}
