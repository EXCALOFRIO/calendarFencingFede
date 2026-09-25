'use server';

import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { athlete, club, entry, eventCompetition } from '@/db/schema';
import { requireProfile } from '@/lib/auth/session';
import type { EntryStatus } from '@/lib/entries/state-machine';

/**
 * Quién va a cada prueba de un torneo.
 *
 * Es la pregunta que hoy se resuelve por WhatsApp: «¿quién va al TNR de
 * Alcobendas?». La aplicación ya tiene la respuesta —son sus propias
 * inscripciones—, solo había que enseñarla.
 *
 * Tres decisiones, con su porqué:
 *
 * 1. **Solo lo que está en marcha de verdad.** Un borrador no es una
 *    inscripción, y una retirada o rechazada tampoco: enseñarlas haría que
 *    alguien contara con un compañero que no va.
 * 2. **Solo nacional e internacional.** Es el ámbito de esta aplicación y de
 *    la selección. No se publica quién compite en una prueba autonómica.
 * 3. **Nombre, club y categoría, y nada más.** Ni fecha de nacimiento, ni
 *    licencia, ni correo. Hay menores en estas listas y lo que hace falta
 *    para responder a la pregunta es el nombre.
 *
 * Se pide al abrir la ficha, no con el calendario entero: son 249 torneos y
 * cargar las inscripciones de todos sería un viaje de red enorme para una
 * información que casi nunca se mira.
 */

const EN_MARCHA: EntryStatus[] = [
  'pending_club',
  'club_approved',
  'federation_approved',
  'submitted',
];

export type Inscrito = {
  competitionId: string;
  nombre: string;
  club: string | null;
  estado: EntryStatus;
};

export async function inscritosDelEvento(eventId: string): Promise<Inscrito[]> {
  // Sesión obligatoria: esto no es información pública.
  await requireProfile();

  const filas = await db
    .select({
      competitionId: entry.eventCompetitionId,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      clubName: club.name,
      status: entry.status,
    })
    .from(entry)
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(athlete, eq(entry.athleteId, athlete.id))
    .leftJoin(club, eq(athlete.clubId, club.id))
    .where(
      and(
        eq(eventCompetition.eventId, eventId),
        inArray(entry.status, EN_MARCHA),
      ),
    )
    .orderBy(asc(athlete.lastName), asc(athlete.firstName));

  return filas.map((f) => ({
    competitionId: f.competitionId,
    nombre: `${f.firstName} ${f.lastName}`.replace(/\bDEMO\b\s*/g, '').trim(),
    club: f.clubName?.replace(/^DEMO\s*·?\s*/i, '') ?? null,
    estado: f.status as EntryStatus,
  }));
}
