'use server';

import { and, eq, inArray, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import {
  athlete,
  entry,
  entryEventLog,
  event,
  eventCompetition,
  notification,
  userProfile,
} from '@/db/schema';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import { canTransition, type EntryStatus } from './state-machine';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Solicitud de inscripción del tirador (o de su tutor).
 *
 * Crea la `entry` directamente en `pending_club`: el paso de "borrador" no
 * aporta nada aquí y solo añade un clic. El club recibe un aviso.
 */
export async function requestEntry(
  competitionId: string,
  athleteId: string,
): Promise<ActionResult> {
  const profile = await requireProfile();

  // Comprobación de permiso: solo se puede inscribir a un tirador propio.
  const managed = await getManagedAthletes(profile.profileId);
  const target = managed.find((a) => a.id === athleteId);

  /**
   * SEGURIDAD: antes bastaba con tener rol `club` para inscribir a CUALQUIER
   * tirador de la base, incluido el de otro club. Un id de tirador no es un
   * secreto (sale en listados y en el CSV), así que la comprobación tiene que
   * ser de pertenencia, no de rol: un club solo puede inscribir a los suyos.
   */
  if (!target) {
    if (profile.role === 'club') {
      /**
       * Sin club asignado no hay "sus" tiradores que valgan. Se corta aquí en
       * vez de consultar con la cadena vacía: `''` no es un UUID válido y
       * Postgres respondería con un error, que la pantalla enseñaría como un
       * fallo del servidor en lugar de como "esto no es tuyo".
       */
      if (!profile.clubId) {
        return { ok: false, error: 'Tu cuenta no tiene club asignado.' };
      }
      const [propio] = await db
        .select({ id: athlete.id })
        .from(athlete)
        .where(and(eq(athlete.id, athleteId), eq(athlete.clubId, profile.clubId)))
        .limit(1);
      if (!propio) {
        return { ok: false, error: 'Ese tirador no es de tu club.' };
      }
    } else if (profile.role !== 'admin') {
      return { ok: false, error: 'Ese tirador no está vinculado a tu cuenta.' };
    }
  }

  const [competition] = await db
    .select({
      id: eventCompetition.id,
      category: eventCompetition.category,
      gender: eventCompetition.gender,
      eventName: event.name,
      eventId: event.id,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(eq(eventCompetition.id, competitionId))
    .limit(1);

  if (!competition) return { ok: false, error: 'Esa prueba ya no existe.' };

  const [existing] = await db
    .select({ id: entry.id, status: entry.status })
    .from(entry)
    .where(
      and(eq(entry.athleteId, athleteId), eq(entry.eventCompetitionId, competitionId)),
    )
    .limit(1);

  if (existing && !['withdrawn', 'rejected'].includes(existing.status)) {
    return { ok: false, error: 'Ya hay una solicitud para esa prueba.' };
  }

  const now = new Date();

  if (existing) {
    // Volver a solicitar tras una retirada o un rechazo.
    const check = canTransition(existing.status as EntryStatus, 'pending_club', profile.role);
    if (!check.ok) return { ok: false, error: check.error };

    await db
      .update(entry)
      .set({
        status: 'pending_club',
        requestedByProfileId: profile.profileId,
        requestedAt: now,
        reason: null,
        updatedAt: now,
      })
      .where(eq(entry.id, existing.id));

    await logTransition(existing.id, existing.status as EntryStatus, 'pending_club', profile.profileId);
  } else {
    const [created] = await db
      .insert(entry)
      .values({
        athleteId,
        eventCompetitionId: competitionId,
        status: 'pending_club',
        requestedByProfileId: profile.profileId,
        requestedAt: now,
      })
      .returning({ id: entry.id });

    await logTransition(created.id, null, 'pending_club', profile.profileId);
  }

  await notifyClub(athleteId, competition.eventName, profile.fullName);

  revalidatePath('/');
  revalidatePath('/calendario');
  revalidatePath('/club');

  return {
    ok: true,
    message: `Solicitud enviada. Ahora le toca a tu club validarla.`,
  };
}

/**
 * Cambia el estado de una inscripción.
 *
 * Toda la validación sale de la máquina de estados, que es el único sitio
 * donde están escritas las transiciones válidas y quién puede hacerlas.
 */
export async function transitionEntry(
  entryId: string,
  to: EntryStatus,
  reason?: string,
): Promise<ActionResult> {
  const profile = await requireProfile();

  const [row] = await db
    .select({
      id: entry.id,
      status: entry.status,
      athleteId: entry.athleteId,
      athleteClubId: athlete.clubId,
    })
    .from(entry)
    .innerJoin(athlete, eq(entry.athleteId, athlete.id))
    .where(eq(entry.id, entryId))
    .limit(1);

  if (!row) return { ok: false, error: 'Esa inscripción ya no existe.' };

  /**
   * Un club solo puede tocar inscripciones de SUS tiradores. Sin esto,
   * cualquier responsable de club podría validar o rechazar las de otro.
   */
  if (profile.role === 'club') {
    /**
     * Ojo con los nulos: sin este primer corte, un responsable de club SIN
     * club asignado (`clubId = null`) pasaba la comparación para cualquier
     * tirador que tampoco tuviera club, porque `null !== null` es falso.
     */
    if (!profile.clubId || row.athleteClubId !== profile.clubId) {
      return { ok: false, error: 'Esa inscripción no es de un tirador de tu club.' };
    }
  }

  /**
   * SEGURIDAD: un tirador o un tutor solo puede tocar las inscripciones de los
   * tiradores que gestiona. Antes solo se comprobaba el caso `club`, así que
   * cualquiera con sesión podía retirar ("withdrawn") o volver a solicitar la
   * inscripción de otra persona con solo conocer su `entryId`, que no es un
   * secreto. La máquina de estados no lo impedía: `withdrawn` está permitido
   * precisamente para el rol `athlete`.
   */
  if (profile.role !== 'admin' && profile.role !== 'club') {
    const gestionados = await getManagedAthletes(profile.profileId);
    if (!gestionados.some((a) => a.id === row.athleteId)) {
      return { ok: false, error: 'Esa inscripción no es de un tirador de tu cuenta.' };
    }
  }

  const check = canTransition(row.status as EntryStatus, to, profile.role, reason);
  if (!check.ok) return { ok: false, error: check.error };

  const now = new Date();
  const patch: Partial<typeof entry.$inferInsert> = {
    status: to,
    reason: reason?.trim() || null,
    updatedAt: now,
  };

  if (to === 'club_approved') {
    patch.clubDecidedByProfileId = profile.profileId;
    patch.clubDecidedAt = now;
  }
  if (to === 'federation_approved') {
    patch.federationDecidedByProfileId = profile.profileId;
    patch.federationDecidedAt = now;
  }
  if (to === 'submitted') patch.submittedAt = now;

  await db.update(entry).set(patch).where(eq(entry.id, entryId));
  await logTransition(entryId, row.status as EntryStatus, to, profile.profileId, reason);
  await notifyAthlete(entryId, to, reason);

  revalidatePath('/');
  revalidatePath('/club');
  revalidatePath('/admin/inscripciones');

  return { ok: true, message: `Inscripción actualizada: ${check.transition.action}.` };
}

/** Deja constancia de cada cambio. Imprescindible cuando alguien diga "yo sí me apunté". */
async function logTransition(
  entryId: string,
  from: EntryStatus | null,
  to: EntryStatus,
  actorProfileId: string,
  reason?: string,
) {
  await db.insert(entryEventLog).values({
    entryId,
    fromStatus: from,
    toStatus: to,
    actorProfileId,
    reason: reason?.trim() || null,
  });
}

async function notifyClub(athleteId: string, eventName: string, requesterName: string) {
  const [row] = await db
    .select({
      athleteName: athlete.firstName,
      athleteSurname: athlete.lastName,
      clubId: athlete.clubId,
    })
    .from(athlete)
    .where(eq(athlete.id, athleteId))
    .limit(1);

  if (!row?.clubId) return;

  const responsables = await db
    .select({ email: userProfile.email })
    .from(userProfile)
    .where(
      and(eq(userProfile.clubId, row.clubId), inArray(userProfile.role, ['club', 'admin'])),
    );

  if (responsables.length === 0) return;

  const nombre = `${row.athleteName} ${row.athleteSurname}`;
  const stamp = new Date().toISOString().slice(0, 16);

  await db
    .insert(notification)
    .values(
      responsables.map((r) => ({
        dedupeKey: `entry-request:${athleteId}:${eventName}:${r.email}:${stamp}`,
        toEmail: r.email,
        kind: 'solicitud_inscripcion',
        subject: `Solicitud de inscripción: ${nombre}`,
        body:
          `${requesterName} ha solicitado la inscripción de ${nombre} en ` +
          `"${eventName}".\n\nEntra en la bandeja de tu club para validarla o ` +
          'rechazarla.\n',
      })),
    )
    .onConflictDoNothing({ target: notification.dedupeKey });
}

async function notifyAthlete(entryId: string, to: EntryStatus, reason?: string) {
  // Solo se avisa de los cambios que le importan a quien solicitó.
  const relevant: EntryStatus[] = [
    'club_approved',
    'federation_approved',
    'submitted',
    'rejected',
  ];
  if (!relevant.includes(to)) return;

  const [row] = await db
    .select({
      email: userProfile.email,
      name: userProfile.fullName,
      eventName: event.name,
    })
    .from(entry)
    .innerJoin(userProfile, eq(entry.requestedByProfileId, userProfile.id))
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(eq(entry.id, entryId))
    .limit(1);

  if (!row) return;

  const textos: Record<string, string> = {
    club_approved: 'Tu club ha validado la inscripción. Ahora la revisa la RFEE.',
    federation_approved: 'La RFEE ha aceptado la inscripción.',
    submitted: 'La inscripción se ha enviado a la organización.',
    rejected: `La inscripción ha sido rechazada.${reason ? ` Motivo: ${reason}` : ''}`,
  };

  await db
    .insert(notification)
    .values({
      dedupeKey: `entry-status:${entryId}:${to}`,
      toEmail: row.email,
      kind: 'estado_inscripcion',
      subject: `${row.eventName}: ${textos[to].split('.')[0]}`,
      body: `Hola ${row.name}:\n\n${textos[to]}\n\nPuedes verlo en "Mi estado".\n`,
      relatedEntryId: entryId,
    })
    .onConflictDoNothing({ target: notification.dedupeKey });
}

/** Cambia varias a la vez desde la bandeja del club o de la federación. */
export async function transitionEntries(
  entryIds: string[],
  to: EntryStatus,
  reason?: string,
): Promise<ActionResult> {
  if (entryIds.length === 0) return { ok: false, error: 'No has seleccionado ninguna.' };

  let ok = 0;
  const errores: string[] = [];

  for (const id of entryIds) {
    const result = await transitionEntry(id, to, reason);
    if (result.ok) ok += 1;
    else errores.push(result.error);
  }

  if (ok === 0) return { ok: false, error: errores[0] ?? 'No se pudo aplicar.' };

  return {
    ok: true,
    message:
      errores.length === 0
        ? `${ok} inscripciones actualizadas.`
        : `${ok} actualizadas, ${errores.length} con problemas: ${errores[0]}`,
  };
}

/** Comprueba si el perfil puede gestionar a ese tirador. */
export async function canManageAthlete(athleteId: string): Promise<boolean> {
  const profile = await requireProfile();
  if (profile.role === 'admin') return true;

  const [row] = await db
    .select({ clubId: athlete.clubId })
    .from(athlete)
    .where(
      and(
        eq(athlete.id, athleteId),
        or(
          eq(athlete.userProfileId, profile.profileId),
          eq(athlete.guardianProfileId, profile.profileId),
        ),
      ),
    )
    .limit(1);

  if (row) return true;
  if (profile.role === 'club') {
    // Igual que en `requestEntry`: sin club no hay nada que gestionar, y
    // consultar con `''` haría fallar la consulta por UUID mal formado.
    if (!profile.clubId) return false;
    const [byClub] = await db
      .select({ id: athlete.id })
      .from(athlete)
      .where(and(eq(athlete.id, athleteId), eq(athlete.clubId, profile.clubId)))
      .limit(1);
    return Boolean(byClub);
  }
  return false;
}
