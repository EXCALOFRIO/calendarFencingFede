'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import {
  athlete,
  callUp,
  callUpAthlete,
  event,
  eventCompetition,
  notification,
  userProfile,
} from '@/db/schema';
import { getManagedAthletes, requireProfile, requireRole } from '@/lib/auth/session';
import { storeFile, storageBackend } from '@/lib/storage';
import { formatDateRangeEs, formatDateTimeEs } from '@/lib/utils';
import { parseFechaMadrid } from './fechas';

export type ResultadoAccion =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Acciones de convocatorias.
 *
 * Dos mundos en el mismo fichero: lo que hace el tirador o su tutor
 * (confirmar / rechazar) y lo que hace el seleccionador (crear, convocar,
 * publicar). Cada acción comprueba por su cuenta quién la llama; una acción de
 * servidor es un endpoint público, así que no vale con que el botón no se vea.
 */

// ------------------------------------------- Respuesta del tirador / tutor ---

/**
 * Confirmar o rechazar una convocatoria.
 *
 * El rechazo EXIGE motivo. Un "no" sin motivo no le sirve de nada al
 * seleccionador: no puede saber si es una lesión, un examen o que el viaje no
 * se puede pagar, y son decisiones distintas.
 */
export async function responderConvocatoria(
  callUpAthleteId: string,
  respuesta: 'confirmado' | 'rechazado',
  motivo?: string,
): Promise<ResultadoAccion> {
  const profile = await requireProfile();

  const [fila] = await db
    .select({
      id: callUpAthlete.id,
      athleteId: callUpAthlete.athleteId,
      status: callUpAthlete.status,
      callUpId: callUp.id,
      published: callUp.published,
      title: callUp.title,
      createdByProfileId: callUp.createdByProfileId,
      eventName: event.name,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
    })
    .from(callUpAthlete)
    .innerJoin(callUp, eq(callUpAthlete.callUpId, callUp.id))
    .innerJoin(event, eq(callUp.eventId, event.id))
    .innerJoin(athlete, eq(callUpAthlete.athleteId, athlete.id))
    .where(eq(callUpAthlete.id, callUpAthleteId))
    .limit(1);

  if (!fila) return { ok: false, error: 'Esa convocatoria ya no existe.' };
  if (!fila.published) {
    return { ok: false, error: 'Esa convocatoria todavía no está publicada.' };
  }

  // Solo se responde por los tiradores que gestiona la cuenta. El admin puede
  // responder por otro (p. ej. una confirmación recibida por teléfono).
  if (profile.role !== 'admin') {
    const gestionados = await getManagedAthletes(profile.profileId);
    if (!gestionados.some((a) => a.id === fila.athleteId)) {
      return { ok: false, error: 'Ese tirador no está vinculado a tu cuenta.' };
    }
  }

  const razon = motivo?.trim() ?? '';
  if (respuesta === 'rechazado' && razon.length < 3) {
    return {
      ok: false,
      error:
        'Para rechazar hace falta explicar el motivo: es lo que permite al ' +
        'seleccionador decidir a quién llama en tu lugar.',
    };
  }

  const ahora = new Date();

  await db
    .update(callUpAthlete)
    .set({
      status: respuesta,
      respondedAt: ahora,
      rejectionReason: respuesta === 'rechazado' ? razon : null,
    })
    .where(eq(callUpAthlete.id, callUpAthleteId));

  await avisarAlSeleccionador(fila, respuesta, razon, profile.fullName, ahora);

  revalidatePath('/convocatorias');
  revalidatePath('/admin/convocatorias');

  return {
    ok: true,
    message:
      respuesta === 'confirmado'
        ? 'Confirmada. El seleccionador ya lo ve en su panel.'
        : 'Rechazada con el motivo indicado. El seleccionador ya lo ve en su panel.',
  };
}

/** El seleccionador se entera de la respuesta por correo, sin entrar a mirar. */
async function avisarAlSeleccionador(
  fila: {
    id: string;
    callUpId: string;
    title: string;
    createdByProfileId: string | null;
    eventName: string;
    firstName: string;
    lastName: string;
  },
  respuesta: 'confirmado' | 'rechazado',
  motivo: string,
  quienResponde: string,
  cuando: Date,
) {
  if (!fila.createdByProfileId) return;

  const [destino] = await db
    .select({ email: userProfile.email })
    .from(userProfile)
    .where(eq(userProfile.id, fila.createdByProfileId))
    .limit(1);

  if (!destino) return;

  const nombre = `${fila.firstName} ${fila.lastName}`.trim();
  const verbo = respuesta === 'confirmado' ? 'ha CONFIRMADO' : 'ha RECHAZADO';

  await db
    .insert(notification)
    .values({
      // El mismo tirador puede cambiar de respuesta; el minuto entra en la
      // clave para que el cambio se avise, pero dos clics seguidos no.
      dedupeKey: `callup-response:${fila.id}:${respuesta}:${cuando
        .toISOString()
        .slice(0, 16)}`,
      toEmail: destino.email,
      kind: 'respuesta_convocatoria',
      subject: `${fila.eventName}: ${nombre} ${verbo.toLowerCase()}`,
      body:
        `${nombre} ${verbo} la convocatoria "${fila.title}".\n` +
        (motivo ? `\nMotivo: ${motivo}\n` : '') +
        `\nRespondido por ${quienResponde} el ${formatDateTimeEs(cuando)}.\n`,
      relatedCallUpId: fila.callUpId,
    })
    .onConflictDoNothing({ target: notification.dedupeKey });
}

// ------------------------------------------------- Gestión del seleccionador ---

/**
 * Crea la convocatoria en borrador.
 *
 * Se crea siempre sin publicar: primero se elige a la gente y se sube el PDF,
 * y solo cuando está todo se publica. Publicar es lo que dispara los avisos, y
 * un aviso no se puede recoger.
 */
export async function crearConvocatoria(
  formData: FormData,
): Promise<ResultadoAccion & { callUpId?: string }> {
  const profile = await requireRole('admin');

  const eventId = String(formData.get('eventId') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const travelNotes = String(formData.get('travelNotes') ?? '').trim();
  const respondBy = parseFechaMadrid(String(formData.get('respondBy') ?? ''));

  if (!eventId) return { ok: false, error: 'Elige el evento de la convocatoria.' };
  if (title.length < 3) return { ok: false, error: 'Ponle un título a la convocatoria.' };

  const [evento] = await db
    .select({ id: event.id, name: event.name })
    .from(event)
    .where(eq(event.id, eventId))
    .limit(1);
  if (!evento) return { ok: false, error: 'Ese evento ya no existe.' };

  let pdfUrl: string | null = null;
  let pdfName: string | null = null;

  const pdf = formData.get('pdf');
  if (pdf instanceof File && pdf.size > 0) {
    if (pdf.type && pdf.type !== 'application/pdf') {
      return { ok: false, error: 'El documento de la convocatoria tiene que ser un PDF.' };
    }
    if (!storageBackend()) {
      return {
        ok: false,
        error:
          'No hay almacenamiento de ficheros configurado, así que el PDF no se ' +
          'puede guardar. Crea la convocatoria sin PDF o configura el almacenamiento.',
      };
    }
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const limpio = pdf.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const guardado = await storeFile(
      `convocatorias/${eventId}/${Date.now()}-${limpio}`,
      bytes,
      { contentType: 'application/pdf' },
    );
    pdfUrl = guardado?.url ?? null;
    pdfName = pdf.name;
  }

  const [creada] = await db
    .insert(callUp)
    .values({
      eventId,
      title,
      body: body || null,
      travelNotes: travelNotes || null,
      respondBy,
      pdfUrl,
      pdfName,
      createdByProfileId: profile.profileId,
    })
    .returning({ id: callUp.id });

  revalidatePath('/admin/convocatorias');

  return {
    ok: true,
    callUpId: creada.id,
    message: `Convocatoria creada en borrador para "${evento.name}". Ahora elige a quién convocas.`,
  };
}

export type SeleccionConvocado = {
  athleteId: string;
  eventCompetitionId: string | null;
  placeType: 'ranking' | 'tecnica';
  rankingPositionAtCutoff: number | null;
};

/**
 * Guarda la lista de convocados.
 *
 * Los que ya han respondido NO se borran aunque se desmarquen: su respuesta es
 * un dato que hay que conservar. Para quitar a alguien que ya contestó está
 * `quitarConvocado`, que es una acción explícita.
 */
export async function guardarConvocados(
  callUpId: string,
  seleccion: SeleccionConvocado[],
): Promise<ResultadoAccion> {
  await requireRole('admin');

  const [convocatoria] = await db
    .select({ id: callUp.id, published: callUp.published })
    .from(callUp)
    .where(eq(callUp.id, callUpId))
    .limit(1);
  if (!convocatoria) return { ok: false, error: 'Esa convocatoria ya no existe.' };

  const existentes = await db
    .select({
      id: callUpAthlete.id,
      athleteId: callUpAthlete.athleteId,
      eventCompetitionId: callUpAthlete.eventCompetitionId,
      status: callUpAthlete.status,
    })
    .from(callUpAthlete)
    .where(eq(callUpAthlete.callUpId, callUpId));

  const clave = (a: { athleteId: string; eventCompetitionId: string | null }) =>
    `${a.athleteId}|${a.eventCompetitionId ?? ''}`;

  const deseadas = new Set(seleccion.map(clave));

  const aBorrar = existentes.filter(
    (e) => !deseadas.has(clave(e)) && e.status === 'pendiente',
  );
  if (aBorrar.length > 0) {
    await db.delete(callUpAthlete).where(
      inArray(
        callUpAthlete.id,
        aBorrar.map((a) => a.id),
      ),
    );
  }

  const yaEstaban = new Set(existentes.map(clave));
  const nuevas = seleccion.filter((s) => !yaEstaban.has(clave(s)));

  if (nuevas.length > 0) {
    await db
      .insert(callUpAthlete)
      .values(
        nuevas.map((n) => ({
          callUpId,
          athleteId: n.athleteId,
          eventCompetitionId: n.eventCompetitionId,
          placeType: n.placeType,
          rankingPositionAtCutoff: n.rankingPositionAtCutoff,
        })),
      )
      .onConflictDoNothing();
  }

  // Cambios de tipo de plaza en los que ya estaban.
  for (const s of seleccion) {
    const previa = existentes.find((e) => clave(e) === clave(s));
    if (!previa) continue;
    await db
      .update(callUpAthlete)
      .set({
        placeType: s.placeType,
        rankingPositionAtCutoff: s.rankingPositionAtCutoff,
      })
      .where(eq(callUpAthlete.id, previa.id));
  }

  /**
   * Si la convocatoria ya estaba publicada, a quien se añade ahora hay que
   * avisarle ahora: si no, se enteraría por un tercero.
   */
  let avisos = 0;
  if (convocatoria.published && nuevas.length > 0) {
    avisos = await encolarAvisos(callUpId, nuevas.map((n) => n.athleteId));
  }

  revalidatePath('/admin/convocatorias');
  revalidatePath('/convocatorias');

  return {
    ok: true,
    message:
      `Lista guardada: ${seleccion.length} convocados` +
      (aBorrar.length > 0 ? `, ${aBorrar.length} retirados` : '') +
      (avisos > 0 ? `, ${avisos} avisos encolados` : '') +
      '.',
  };
}

/** Quita a un convocado, incluso si ya había respondido. */
export async function quitarConvocado(rowId: string): Promise<ResultadoAccion> {
  await requireRole('admin');
  await db.delete(callUpAthlete).where(eq(callUpAthlete.id, rowId));
  revalidatePath('/admin/convocatorias');
  revalidatePath('/convocatorias');
  return { ok: true, message: 'Convocado retirado de la lista.' };
}

/**
 * Publica la convocatoria y encola los avisos.
 *
 * Aquí NO se envía ningún correo: solo se escriben filas en `notification`. El
 * envío lo hace el cron, que puede reintentar sin duplicar. Si el envío
 * dependiera de que esta petición HTTP sobreviva, un timeout dejaría a media
 * selección sin enterarse.
 */
export async function publicarConvocatoria(callUpId: string): Promise<ResultadoAccion> {
  await requireRole('admin');

  const [convocatoria] = await db
    .select({
      id: callUp.id,
      published: callUp.published,
      title: callUp.title,
      eventName: event.name,
    })
    .from(callUp)
    .innerJoin(event, eq(callUp.eventId, event.id))
    .where(eq(callUp.id, callUpId))
    .limit(1);

  if (!convocatoria) return { ok: false, error: 'Esa convocatoria ya no existe.' };
  if (convocatoria.published) {
    return { ok: false, error: 'Esa convocatoria ya estaba publicada.' };
  }

  const convocados = await db
    .select({ athleteId: callUpAthlete.athleteId })
    .from(callUpAthlete)
    .where(eq(callUpAthlete.callUpId, callUpId));

  if (convocados.length === 0) {
    return {
      ok: false,
      error: 'No puedes publicar una convocatoria sin nadie convocado.',
    };
  }

  const ahora = new Date();
  await db
    .update(callUp)
    .set({ published: true, publishedAt: ahora, updatedAt: ahora })
    .where(eq(callUp.id, callUpId));

  const avisos = await encolarAvisos(
    callUpId,
    convocados.map((c) => c.athleteId),
  );

  revalidatePath('/admin/convocatorias');
  revalidatePath('/convocatorias');

  return {
    ok: true,
    message:
      `Convocatoria publicada. ${avisos} avisos encolados` +
      (avisos < convocados.length
        ? `; ${convocados.length - avisos} convocados no tienen correo asociado ` +
          '(ni cuenta propia ni tutor), así que hay que avisarles a mano.'
        : '.'),
  };
}

/**
 * Escribe las filas de `notification`. Destinatario: el propio tirador si
 * tiene cuenta, y si no su tutor. Los menores de 14 no tienen cuenta propia
 * por exigencia del RGPD, así que el aviso va al tutor por diseño.
 */
async function encolarAvisos(callUpId: string, athleteIds: string[]): Promise<number> {
  if (athleteIds.length === 0) return 0;

  const [convocatoria] = await db
    .select({
      title: callUp.title,
      respondBy: callUp.respondBy,
      pdfUrl: callUp.pdfUrl,
      eventName: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      city: event.city,
    })
    .from(callUp)
    .innerJoin(event, eq(callUp.eventId, event.id))
    .where(eq(callUp.id, callUpId))
    .limit(1);

  if (!convocatoria) return 0;

  const filas = await db
    .select({
      rowId: callUpAthlete.id,
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      propio: userProfile.email,
    })
    .from(callUpAthlete)
    .innerJoin(athlete, eq(callUpAthlete.athleteId, athlete.id))
    .leftJoin(userProfile, eq(athlete.userProfileId, userProfile.id))
    .where(
      and(
        eq(callUpAthlete.callUpId, callUpId),
        inArray(callUpAthlete.athleteId, athleteIds),
      ),
    );

  // El correo del tutor se busca aparte para no hacer dos joins a la misma
  // tabla en una consulta que ya es larga.
  const tutores = await db
    .select({ athleteId: athlete.id, email: userProfile.email })
    .from(athlete)
    .innerJoin(userProfile, eq(athlete.guardianProfileId, userProfile.id))
    .where(inArray(athlete.id, athleteIds));

  const valores = [];
  for (const fila of filas) {
    const email =
      fila.propio ?? tutores.find((t) => t.athleteId === fila.athleteId)?.email ?? null;
    if (!email) continue;

    const nombre = `${fila.firstName} ${fila.lastName}`.trim();
    const limite = convocatoria.respondBy
      ? `Hay que responder antes del ${formatDateTimeEs(convocatoria.respondBy)}.`
      : 'Responde cuanto antes.';

    valores.push({
      dedupeKey: `callup-published:${fila.rowId}`,
      toEmail: email,
      kind: 'convocatoria',
      subject: `Convocatoria: ${nombre} · ${convocatoria.eventName}`,
      body:
        `${nombre} ha sido convocado para "${convocatoria.title}".\n\n` +
        `${convocatoria.eventName}\n` +
        `${formatDateRangeEs(convocatoria.startDate, convocatoria.endDate)}` +
        `${convocatoria.city ? ` · ${convocatoria.city}` : ''}\n\n` +
        `${limite}\n\n` +
        (convocatoria.pdfUrl ? `Documento oficial: ${convocatoria.pdfUrl}\n\n` : '') +
        'Entra en "Convocatorias" para confirmar o rechazar. Si rechazas, hay ' +
        'que indicar el motivo.\n',
      relatedCallUpId: callUpId,
    });
  }

  if (valores.length === 0) return 0;

  const insertadas = await db
    .insert(notification)
    .values(valores)
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning({ id: notification.id });

  await db
    .update(callUpAthlete)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        eq(callUpAthlete.callUpId, callUpId),
        inArray(callUpAthlete.athleteId, athleteIds),
      ),
    );

  return insertadas.length;
}

/** Borra una convocatoria. Solo en borrador: lo publicado no se hace desaparecer. */
export async function eliminarConvocatoria(callUpId: string): Promise<ResultadoAccion> {
  await requireRole('admin');

  const [fila] = await db
    .select({ published: callUp.published })
    .from(callUp)
    .where(eq(callUp.id, callUpId))
    .limit(1);

  if (!fila) return { ok: false, error: 'Esa convocatoria ya no existe.' };
  if (fila.published) {
    return {
      ok: false,
      error:
        'Una convocatoria publicada no se borra: la gente ya la ha visto y ' +
        'algunos habrán respondido. Retira a los convocados si hace falta.',
    };
  }

  await db.delete(callUp).where(eq(callUp.id, callUpId));
  revalidatePath('/admin/convocatorias');
  return { ok: true, message: 'Borrador eliminado.' };
}

/** Pruebas de un evento, para el desplegable de "a qué prueba se convoca". */
export async function pruebasDelEvento(eventId: string) {
  await requireRole('admin');
  return db
    .select({
      id: eventCompetition.id,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
    })
    .from(eventCompetition)
    .where(eq(eventCompetition.eventId, eventId));
}
