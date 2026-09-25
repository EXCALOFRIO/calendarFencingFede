import { and, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import {
  athlete,
  event,
  eventCompetition,
  eventDeadline,
  entry,
  notification,
  userProfile,
} from '@/db/schema';
import type { CategoryCode } from '@/lib/categories';
import {
  type ComputedDeadline,
  DEADLINE_TYPE_LABEL,
  type Scope,
  computeDeadlines,
  mergeDeadlines,
} from '@/lib/deadlines';
import { sendPendingNotifications } from '@/lib/email/resend';
import { getDeadlineRules } from '@/lib/queries/calendar';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  WEAPON_LABEL,
  formatDateRangeEs,
  formatDateTimeEs,
  formatEur,
} from '@/lib/utils';

/**
 * Cron diario de avisos (ver `vercel.json`: 07:00 UTC).
 *
 * Hace dos cosas, en este orden:
 *   a) encola los avisos de plazo próximo, y
 *   b) vacía la cola de correo.
 *
 * Encolar y enviar están separados a propósito: si el envío falla a mitad, los
 * avisos ya están guardados y salen mañana; y si el correo no está configurado,
 * la cola se llena igual y se enviará el día que se configure.
 */

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Antelación del aviso de cierre. Tres días dan margen para reaccionar. */
const DIAS_DE_AVISO = 3;

/** Cuántos correos se intentan por ejecución. Con el tope de 100/día sobra. */
const CORREOS_POR_PASADA = 40;

export async function GET(request: Request) {
  const denegado = autorizarCron(request);
  if (denegado) return denegado;

  const ahora = new Date();

  const avisos = await encolarAvisosDePlazo(ahora);
  const correo = await sendPendingNotifications(CORREOS_POR_PASADA, ahora);

  return Response.json({
    ok: true,
    avisosEncolados: avisos.encolados,
    inscripcionesRevisadas: avisos.revisadas,
    correo,
  });
}

type FilaInscripcion = {
  entryId: string;
  status: string;
  athleteFirstName: string;
  athleteLastName: string;
  competitionId: string;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  feeEur: string | null;
  eventId: string;
  eventName: string;
  startDate: string;
  endDate: string;
  city: string | null;
  scope: string;
  circuit: string;
  ownerEmail: string | null;
  ownerName: string | null;
  guardianEmail: string | null;
  guardianName: string | null;
};

/**
 * Encola un aviso por cada inscripción cuyo cierre ordinario vence dentro de
 * tres días.
 *
 * No se avisa de las ya enviadas (`submitted`): quien ya está inscrito no tiene
 * nada que hacer con este plazo, y un correo que no pide ninguna acción es la
 * forma más rápida de que la gente deje de leer los que sí la piden.
 */
async function encolarAvisosDePlazo(
  ahora: Date,
): Promise<{ encolados: number; revisadas: number }> {
  const propietario = alias(userProfile, 'perfil_propietario');
  const tutor = alias(userProfile, 'perfil_tutor');

  const filas: FilaInscripcion[] = await db
    .select({
      entryId: entry.id,
      status: entry.status,
      athleteFirstName: athlete.firstName,
      athleteLastName: athlete.lastName,
      competitionId: eventCompetition.id,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      feeEur: eventCompetition.feeEur,
      eventId: event.id,
      eventName: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      city: event.city,
      scope: event.scope,
      circuit: event.circuit,
      ownerEmail: propietario.email,
      ownerName: propietario.fullName,
      guardianEmail: tutor.email,
      guardianName: tutor.fullName,
    })
    .from(entry)
    .innerJoin(athlete, eq(entry.athleteId, athlete.id))
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .leftJoin(propietario, eq(athlete.userProfileId, propietario.id))
    .leftJoin(tutor, eq(athlete.guardianProfileId, tutor.id))
    .where(
      and(
        inArray(entry.status, [
          'draft',
          'pending_club',
          'club_approved',
          'federation_approved',
        ]),
        isNull(event.disappearedAt),
        eq(event.cancelled, false),
      ),
    );

  if (filas.length === 0) return { encolados: 0, revisadas: 0 };

  const eventIds = [...new Set(filas.map((f) => f.eventId))];

  const [publicados, reglas] = await Promise.all([
    db.select().from(eventDeadline).where(inArray(eventDeadline.eventId, eventIds)),
    getDeadlineRules(),
  ]);

  const pendientes: (typeof notification.$inferInsert)[] = [];

  for (const fila of filas) {
    /**
     * Mismo cálculo que en el calendario y en la ficha: plazos publicados por
     * la fuente, que ganan siempre, más los estimados a partir de la normativa.
     * Si esto divergiera de `listEvents`, el correo diría una fecha y la
     * pantalla otra, que es peor que no avisar.
     */
    const propios = publicados
      .filter(
        (d) =>
          d.eventId === fila.eventId &&
          (d.eventCompetitionId === null ||
            d.eventCompetitionId === fila.competitionId) &&
          d.origin === 'PUBLICADO',
      )
      .map(
        (d): ComputedDeadline => ({
          type: d.type,
          label: DEADLINE_TYPE_LABEL[d.type],
          deadlineAt: d.deadlineAt,
          surchargeEur: d.surchargeEur,
          blocking: d.blocking,
          origin: d.origin,
          sourceDocument: d.sourceDocument,
          sourceUrl: d.sourceUrl,
        }),
      );

    const calculados = computeDeadlines(fila.startDate, reglas, {
      scope: fila.scope as Scope,
      circuit: fila.circuit,
      category: fila.category as CategoryCode,
    });

    const plazos = mergeDeadlines(propios, calculados);

    /**
     * El hito que interesa es el cierre ordinario (L1) o, si vence antes, un
     * cierre duro: pasarse del bloqueante no cuesta un recargo, cuesta el
     * torneo entero.
     */
    const objetivo = plazos
      .filter((d) => d.deadlineAt.getTime() > ahora.getTime())
      .filter((d) => d.type === 'L1' || d.blocking)
      .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime())[0];

    if (!objetivo) continue;

    const diasRestantes = Math.ceil(
      (objetivo.deadlineAt.getTime() - ahora.getTime()) / 86_400_000,
    );
    if (diasRestantes > DIAS_DE_AVISO) continue;

    // Tirador con cuenta propia y tutor a la vez: se avisa a los dos, pero cada
    // dirección una sola vez.
    const destinatarios = [
      { email: fila.ownerEmail, nombre: fila.ownerName },
      { email: fila.guardianEmail, nombre: fila.guardianName },
    ].filter(
      (d, i, arr): d is { email: string; nombre: string } =>
        Boolean(d.email) && arr.findIndex((o) => o.email === d.email) === i,
    );

    for (const destinatario of destinatarios) {
      pendientes.push({
        /**
         * Clave estable: misma inscripción, mismo hito, misma fecha y mismo
         * destinatario = un solo correo, ejecute el cron una vez o veinte. Si
         * la fecha del plazo cambia, la clave cambia y se vuelve a avisar, que
         * es exactamente lo que se quiere.
         */
        dedupeKey:
          `plazo:${fila.entryId}:${objetivo.type}:` +
          `${objetivo.deadlineAt.toISOString().slice(0, 10)}:${destinatario.email}`,
        toEmail: destinatario.email,
        kind: 'plazo_proximo',
        subject: `Cierre de inscripción en ${diasRestantes} ${
          diasRestantes === 1 ? 'día' : 'días'
        }: ${fila.eventName}`,
        body: cuerpoDelAviso(fila, objetivo, diasRestantes, destinatario.nombre),
        relatedEntryId: fila.entryId,
        relatedEventId: fila.eventId,
      });
    }
  }

  if (pendientes.length === 0) return { encolados: 0, revisadas: filas.length };

  const insertados = await db
    .insert(notification)
    .values(pendientes)
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning({ id: notification.id });

  return { encolados: insertados.length, revisadas: filas.length };
}

const ESTADO_LEGIBLE: Record<string, string> = {
  draft: 'en borrador',
  pending_club: 'pendiente de que la valide tu club',
  club_approved: 'validada por el club, pendiente de la federación',
  federation_approved: 'aprobada por la federación, pendiente de envío',
};

function cuerpoDelAviso(
  fila: FilaInscripcion,
  plazo: ComputedDeadline,
  diasRestantes: number,
  nombreDestinatario: string,
): string {
  const tirador = `${fila.athleteFirstName} ${fila.athleteLastName}`.trim();
  const prueba =
    `${WEAPON_LABEL[fila.weapon]} ${GENDER_LABEL[fila.gender]} ` +
    `${CATEGORY_LABEL[fila.category as CategoryCode] ?? fila.category}`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  const ficha = appUrl ? `${appUrl}/calendario?evento=${fila.eventId}` : null;

  const consecuencia = plazo.blocking
    ? 'Pasada esa fecha ya no se puede inscribir, ni pagando recargo.'
    : plazo.surchargeEur && Number.parseFloat(plazo.surchargeEur) > 0
      ? `A partir de ese momento la inscripción sale ${formatEur(
          plazo.surchargeEur,
        )} más cara.`
      : 'A partir de ese momento cambian las condiciones de inscripción.';

  const lineas = [
    `Hola ${nombreDestinatario}:`,
    '',
    `Quedan ${diasRestantes} ${diasRestantes === 1 ? 'día' : 'días'} para el ` +
      `${(plazo.label || DEADLINE_TYPE_LABEL[plazo.type]).toLowerCase()} de una ` +
      'prueba en la que hay una inscripción en marcha.',
    '',
    `Tirador: ${tirador}`,
    `Prueba: ${prueba}`,
    `Competición: ${fila.eventName}`,
    `Fechas: ${formatDateRangeEs(fila.startDate, fila.endDate)}${
      fila.city ? ` · ${fila.city}` : ''
    }`,
    `Cuota: ${formatEur(fila.feeEur)}`,
    `Estado de la inscripción: ${ESTADO_LEGIBLE[fila.status] ?? fila.status}`,
    '',
    `Plazo: ${formatDateTimeEs(plazo.deadlineAt)} (hora peninsular).`,
    consecuencia,
  ];

  /**
   * Un plazo estimado NUNCA se presenta como si fuera oficial: se dice de dónde
   * sale y se pide comprobar la convocatoria. Es la misma regla que en la
   * pantalla, y aquí importa más, porque un correo se lee sin contexto.
   */
  if (plazo.origin === 'CALCULADO') {
    lineas.push(
      '',
      'Atención: esta fecha es una ESTIMACIÓN a partir de la normativa ' +
        'general, no un plazo publicado en la convocatoria de esta prueba. ' +
        'Confirma siempre con el documento oficial.',
    );
    if (plazo.sourceDocument) {
      lineas.push(`Normativa aplicada: ${plazo.sourceDocument}.`);
    }
    if (plazo.sourceUrl) lineas.push(plazo.sourceUrl);
  }

  if (ficha) {
    lineas.push('', `Ficha de la prueba: ${ficha}`);
  }

  return `${lineas.join('\n')}\n`;
}

/**
 * Protección del cron. Mismo esquema que la ruta de ingestión y duplicado por
 * el mismo motivo: que cada endpoint público se pueda auditar sin saltar a otro
 * fichero.
 */
function autorizarCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return Response.json(
        {
          ok: false,
          error:
            'Falta CRON_SECRET en el entorno. Defínela en Vercel para que el ' +
            'cron pueda ejecutarse.',
        },
        { status: 503 },
      );
    }
    return null;
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  }

  return null;
}
