'use server';

import { and, asc, eq } from 'drizzle-orm';
import { enLista as inArray } from '@/lib/sqlite';
import { db } from '@/db';
import { athlete, club, entry, eventCompetition } from '@/db/schema';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import type { EntryStatus } from '@/lib/entries/state-machine';
import { aListaVisible } from '@/lib/entries/union';
import type { EstadoLista } from '@/lib/entries/lectura';
import { inscritosUnidosDeTorneos, type InscritoPublicado } from '@/lib/queries/inscritos-union';

/**
 * Quién va a cada prueba de un torneo.
 *
 * **La lista oficial**, la que publica la organización, es la única que se
 * enseña. Aquí aparece quien se haya apuntado por donde sea: por esta
 * aplicación, por su club directamente en Skermo o porque le apuntó el
 * seleccionador. Responde a la pregunta que pidió el usuario con estas
 * palabras: *«que pueda recuperar si estás o no ya inscrito, porque igual le
 * ha inscrito otra persona»*.
 *
 * ---------------------------------------------------------------------------
 * `pendientes` SE QUEDÓ SOLO PARA LA DIRECCIÓN TÉCNICA
 * ---------------------------------------------------------------------------
 * Era la segunda lista: lo pedido desde aquí y que todavía no había llegado a
 * la oficial. Tenía sentido cuando la aplicación tramitaba inscripciones, y ya
 * no las tramita:
 *
 *   «quita todo lo de clubes, lo de códigos de licencia, lo de darse o no de
 *    alta en los torneos, eso está oculto: solo ver calendario, si estoy o no»
 *
 * Una solicitud esperando a que la valide alguien **no es estar dentro**, así
 * que enseñarla al lado de la lista oficial solo puede confundir. Se calcula
 * únicamente para `admin`, que es quien tramita y para quien el dato sigue
 * siendo trabajo pendiente; para todos los demás sale vacía y **la consulta no
 * se hace**, que de paso ahorra una unión de cuatro tablas cada vez que alguien
 * abre una ficha de torneo.
 *
 * El campo no desaparece del tipo a propósito: la ficha del calendario ya solo
 * lee `oficiales`, y quitarlo obligaría a tocar dos ficheros de otro agente
 * para no ganar nada.
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
  /**
   * Lo que publican las organizaciones, unido en una sola lista sin marca de
   * origen por persona. Es la lista que manda.
   */
  oficiales: InscritoPublicado[];
  /** Por prueba: sin consultar, vacía o con datos. Un fallo lo señala quien llama. */
  estados: Record<string, EstadoLista>;
  /**
   * Solicitudes hechas desde aquí que aún no figuran en la oficial.
   * **Solo para la dirección técnica**; vacía para todos los demás.
   */
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

  const [unidas, filas] = await Promise.all([
    inscritosUnidosDeTorneos([eventId]),
    perfil.role === 'admin'
      ? db
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
          .orderBy(asc(athlete.lastName), asc(athlete.firstName))
      : Promise.resolve([]),
  ]);

  /**
   * Quien ya figura en la lista oficial no se repite abajo: la solicitud
   * cumplió su función y lo importante es que está dentro.
   */
  const yaOficiales = new Set(
    unidas.filas.flatMap((o) =>
      o.athleteIds.map((id) => `${o.competitionId}|${id}`),
    ),
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

  return {
    oficiales: aListaVisible(unidas.filas, new Set(idsPropios)),
    estados: unidas.estados,
    pendientes,
  };
}
