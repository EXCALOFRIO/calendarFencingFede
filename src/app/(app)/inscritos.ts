'use server';

import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { athlete, club, entry, eventCompetition } from '@/db/schema';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import type { EntryStatus } from '@/lib/entries/state-machine';
import { inscritosPublicados, type InscritoPublicado } from '@/lib/queries/calendar';

/**
 * Quién va a cada prueba de un torneo.
 *
 * Son DOS listas distintas y se enseñan por separado a propósito:
 *
 * 1. **La lista oficial**, la que publica la organización. Es la que manda.
 *    Aquí aparece quien se haya apuntado por donde sea: por esta aplicación,
 *    por su club directamente en Skermo o porque le apuntó el seleccionador.
 *    Responde a la pregunta que pidió el usuario con estas palabras: *«que
 *    pueda recuperar si estás o no ya inscrito, porque igual le ha inscrito
 *    otra persona»*.
 * 2. **Lo pedido desde aquí** y que todavía no ha llegado a esa lista: una
 *    solicitud esperando al club o a la RFEE no es una inscripción, y
 *    mezclarlas haría que alguien viajase creyendo que está dentro.
 *
 * Tres decisiones más, con su porqué:
 *
 * - **Solo lo que está en marcha de verdad** en la lista nuestra. Un
 *   borrador no es una inscripción, y una retirada o rechazada tampoco.
 * - **Nombre, club y estado, y nada más.** Ni fecha de nacimiento, ni
 *   licencia, ni correo. Hay menores en estas listas.
 * - Se pide **al abrir la ficha**, no con el calendario: son 249 torneos y
 *   cargar los inscritos de todos sería un viaje de red enorme para una
 *   información que casi nunca se mira.
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
  /** Si es uno de los tiradores que gestiona quien está mirando. */
  esMio: boolean;
};

export type QuienVa = {
  /** Lo que publica la organización. Es la lista que manda. */
  oficiales: InscritoPublicado[];
  /** Solicitudes hechas desde aquí que aún no figuran en la oficial. */
  pendientes: Inscrito[];
};

/** Quita la marca de los datos de demostración de un texto visible. */
function limpio(texto: string): string {
  return texto.replace(/\bDEMO\b\s*·?\s*/gi, '').trim();
}

export async function inscritosDelEvento(eventId: string): Promise<QuienVa> {
  // Sesión obligatoria: esto no es información pública dentro de la app.
  const perfil = await requireProfile();
  const mios = await getManagedAthletes(perfil.profileId);
  const idsPropios = mios.map((a) => a.id);

  const [oficiales, filas] = await Promise.all([
    inscritosPublicados(eventId, { athleteIdsPropios: idsPropios }),
    db
      .select({
        competitionId: entry.eventCompetitionId,
        athleteId: entry.athleteId,
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
        and(eq(eventCompetition.eventId, eventId), inArray(entry.status, EN_MARCHA)),
      )
      .orderBy(asc(athlete.lastName), asc(athlete.firstName)),
  ]);

  /**
   * Quien ya figura en la lista oficial no se repite abajo: la solicitud
   * cumplió su función y lo importante es que está dentro.
   */
  const yaOficiales = new Set(
    oficiales.map((o) => `${o.competitionId}|${o.athleteId ?? ''}`),
  );

  const pendientes = filas
    .filter((f) => !yaOficiales.has(`${f.competitionId}|${f.athleteId}`))
    .map((f) => ({
      competitionId: f.competitionId,
      nombre: limpio(`${f.firstName} ${f.lastName}`),
      club: f.clubName ? limpio(f.clubName) : null,
      estado: f.status as EntryStatus,
      esMio: idsPropios.includes(f.athleteId),
    }));

  return { oficiales, pendientes };
}
