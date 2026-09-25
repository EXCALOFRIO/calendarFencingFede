import 'dotenv/config';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { db } from '../../src/db';
import {
  athlete,
  athleteWeapon,
  callUp,
  callUpAthlete,
  club,
  entry,
  entryEventLog,
  notification,
  userProfile,
} from '../../src/db/schema';

/**
 * Datos de prueba de la tanda de FLUJOS.
 *
 * La marca es `e2e-flujo-` y no el genérico `e2e-` a propósito: hay otra
 * tanda (`tests/seguridad.test.ts`) que usa `e2e-seg-`, y un limpiado por
 * `e2e-%` le borraría los datos a mitad de ejecución. Cada tanda barre solo
 * lo suyo.
 *
 * Nada de datos inventados en tablas que ya tenían contenido (eventos,
 * pruebas, circulares, resultados): esas se leen tal cual están.
 */

export const MARCA = 'e2e-flujo-';

export type Fixtures = {
  clubAlfaId: string;
  clubBetaId: string;
  tiradorAlfaId: string;
  tiradorBetaId: string;
};

export async function crearClubes(): Promise<{ alfa: string; beta: string }> {
  const [alfa] = await db
    .insert(club)
    .values({
      name: `${MARCA}Club Alfa`,
      shortName: 'E2E-A',
      regionalFederation: 'Pruebas',
      contactEmail: `${MARCA}alfa@pruebas.local`,
    })
    .returning({ id: club.id });

  const [beta] = await db
    .insert(club)
    .values({
      name: `${MARCA}Club Beta`,
      shortName: 'E2E-B',
      regionalFederation: 'Pruebas',
      contactEmail: `${MARCA}beta@pruebas.local`,
    })
    .returning({ id: club.id });

  return { alfa: alfa.id, beta: beta.id };
}

/** Asocia un perfil ya creado a un club concreto. */
export async function asignarClub(profileId: string, clubId: string | null) {
  await db.update(userProfile).set({ clubId }).where(eq(userProfile.id, profileId));
}

export async function crearTirador(opciones: {
  nombre: string;
  apellido: string;
  nacimiento: string;
  genero: 'M' | 'F';
  clubId: string;
  licencia: string;
  armas: ('FLORETE' | 'ESPADA' | 'SABLE')[];
  perfilId?: string | null;
  tutorId?: string | null;
  consentimiento?: boolean;
}): Promise<string> {
  const [a] = await db
    .insert(athlete)
    .values({
      firstName: opciones.nombre,
      lastName: opciones.apellido,
      birthDate: opciones.nacimiento,
      gender: opciones.genero,
      clubId: opciones.clubId,
      rfeeLicense: opciones.licencia,
      userProfileId: opciones.perfilId ?? null,
      guardianProfileId: opciones.tutorId ?? null,
      consentSignedAt: opciones.consentimiento === false ? null : new Date(),
    })
    .returning({ id: athlete.id });

  if (opciones.armas.length > 0) {
    await db
      .insert(athleteWeapon)
      .values(opciones.armas.map((weapon, i) => ({ athleteId: a.id, weapon, primary: i === 0 })));
  }

  return a.id;
}

/** Estado e historial de una inscripción, para comprobar la auditoría. */
export async function leerInscripcion(athleteId: string, competitionId: string) {
  const [fila] = await db
    .select()
    .from(entry)
    .where(and(eq(entry.athleteId, athleteId), eq(entry.eventCompetitionId, competitionId)))
    .limit(1);

  if (!fila) return null;

  const log = await db
    .select()
    .from(entryEventLog)
    .where(eq(entryEventLog.entryId, fila.id))
    .orderBy(entryEventLog.createdAt);

  return { entrada: fila, log };
}

export async function crearInscripcion(
  athleteId: string,
  competitionId: string,
  requestedByProfileId: string,
): Promise<string> {
  const [fila] = await db
    .insert(entry)
    .values({
      athleteId,
      eventCompetitionId: competitionId,
      status: 'pending_club',
      requestedByProfileId,
      requestedAt: new Date(),
    })
    .returning({ id: entry.id });

  await db.insert(entryEventLog).values({
    entryId: fila.id,
    fromStatus: null,
    toStatus: 'pending_club',
    actorProfileId: requestedByProfileId,
  });

  return fila.id;
}

export async function crearConvocatoriaBorrador(
  eventId: string,
  creadorProfileId: string,
): Promise<string> {
  const [c] = await db
    .insert(callUp)
    .values({
      eventId,
      title: `${MARCA}Convocatoria de prueba`,
      body: 'Convocatoria creada por las pruebas automáticas.',
      published: false,
      createdByProfileId: creadorProfileId,
    })
    .returning({ id: callUp.id });
  return c.id;
}

/**
 * Deja la base como estaba.
 *
 * El orden importa: primero lo que cuelga de los tiradores y de los perfiles,
 * y al final los clubes, porque `athlete.club_id` y `user_profile.club_id`
 * apuntan a ellos.
 */
export async function limpiar(): Promise<string[]> {
  const hecho: string[] = [];

  const perfiles = await db
    .select({ id: userProfile.id, email: userProfile.email })
    .from(userProfile)
    .where(like(userProfile.email, `${MARCA}%`));
  const perfilIds = perfiles.map((p) => p.id);

  const clubes = await db
    .select({ id: club.id })
    .from(club)
    .where(like(club.name, `${MARCA}%`));
  const clubIds = clubes.map((c) => c.id);

  /**
   * Tiradores de prueba. Se buscan por CUATRO vías a propósito: si una
   * ejecución se corta a medias, el club o el perfil pueden haber
   * desaparecido ya (las claves ajenas son `set null`) y el tirador quedaría
   * huérfano para siempre. La licencia y el apellido son la red de seguridad.
   */
  const condiciones = [
    like(athlete.rfeeLicense, 'E2EFLUJO-%'),
    like(athlete.lastName, 'Flujos %'),
  ];
  if (clubIds.length > 0) condiciones.push(inArray(athlete.clubId, clubIds));
  if (perfilIds.length > 0) {
    condiciones.push(inArray(athlete.userProfileId, perfilIds));
    condiciones.push(inArray(athlete.guardianProfileId, perfilIds));
  }

  const atletas = await db
    .select({ id: athlete.id })
    .from(athlete)
    .where(or(...condiciones));
  const atletaIds = atletas.map((a) => a.id);

  if (atletaIds.length > 0) {
    // Las notificaciones no caen con la inscripción (la FK es SET NULL), así
    // que se borran por la clave de deduplicación, que lleva el id del tirador.
    await db.execute(
      sql`delete from notification where ${sql.join(
        atletaIds.map((id) => sql`dedupe_key like ${'%' + id + '%'}`),
        sql` or `,
      )}`,
    );
    await db.delete(callUpAthlete).where(inArray(callUpAthlete.athleteId, atletaIds));
    await db.delete(entry).where(inArray(entry.athleteId, atletaIds));
    await db.delete(athleteWeapon).where(inArray(athleteWeapon.athleteId, atletaIds));
    await db.delete(athlete).where(inArray(athlete.id, atletaIds));
    hecho.push(`tiradores: ${atletaIds.length}`);
  }

  const convocatorias = await db
    .delete(callUp)
    .where(like(callUp.title, `${MARCA}%`))
    .returning({ id: callUp.id });
  if (convocatorias.length > 0) hecho.push(`convocatorias: ${convocatorias.length}`);

  const notis = await db
    .delete(notification)
    .where(like(notification.toEmail, `${MARCA}%`))
    .returning({ id: notification.id });
  if (notis.length > 0) hecho.push(`notificaciones: ${notis.length}`);

  if (perfilIds.length > 0) {
    await db.delete(userProfile).where(inArray(userProfile.id, perfilIds));
    hecho.push(`perfiles: ${perfilIds.length}`);
  }

  if (clubIds.length > 0) {
    await db.delete(club).where(inArray(club.id, clubIds));
    hecho.push(`clubes: ${clubIds.length}`);
  }

  return hecho;
}
