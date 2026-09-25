import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { Resend } from 'resend';
import { db } from '@/db';
import { notification } from '@/db/schema';

/**
 * Envío de la cola de correos con Resend.
 *
 * La cola (`notification`) se llena en la ingestión y en las acciones de
 * inscripción; aquí solo se vacía. Separarlo es lo que permite reintentar sin
 * duplicar y no depender de que una petición HTTP sobreviva al envío.
 *
 * Principio de diseño: SIN RESEND_API_KEY LA APP FUNCIONA IGUAL. Si no hay
 * clave, esto no lanza: registra que el correo está desactivado y devuelve el
 * motivo. Los avisos se quedan encolados y se envían el día que se configure.
 * Un despliegue de prueba no debe romperse por no tener correo.
 */

/** Tope del plan gratuito de Resend: 100 correos al día. Configurable. */
const TOPE_DIARIO_POR_DEFECTO = 100;

/**
 * Tras cinco intentos fallidos se deja de reintentar: casi siempre es una
 * dirección que no existe, y seguir insistiendo se come la cuota diaria de los
 * avisos que sí llegarían.
 */
const MAX_INTENTOS = 5;

/**
 * Resend limita a 2 peticiones por segundo en el plan gratuito. Se espera algo
 * más de medio segundo entre envíos: es preferible a comerse un 429 y marcar
 * como fallidos correos que en realidad no se han intentado.
 */
const PAUSA_ENTRE_ENVIOS_MS = 600;

export type EnvioCorreoResult = {
  /** False cuando falta configuración. No es un error: es un estado válido. */
  enabled: boolean;
  /** Por qué está desactivado, o `null` si está activo. */
  reason: string | null;
  sent: number;
  failed: number;
  /** Pendientes que quedan en la cola después de esta pasada. */
  pending: number;
  /** Envíos que aún caben hoy dentro del tope. */
  dailyRemaining: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Firma del correo. Sobria y en texto plano a propósito: estos avisos se leen
 * en el móvil, muchas veces con mala cobertura camino de un torneo, y el HTML
 * solo añade peso y formas de que se vea mal.
 */
function componerTexto(body: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const lineas = [
    body.trimEnd(),
    '',
    '—',
    'Calendario de Esgrima',
    'Aviso automático: no respondas a este correo.',
  ];
  if (appUrl) lineas.push(appUrl);
  return `${lineas.join('\n')}\n`;
}

/** Comienzo del día en UTC, que es como cuenta Resend su cuota diaria. */
function inicioDelDiaUtc(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

async function contarPendientes(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(isNull(notification.sentAt), lt(notification.attempts, MAX_INTENTOS)));
  return row?.count ?? 0;
}

/**
 * Envía hasta `limit` correos pendientes.
 *
 * Marca `sentAt` al acertar, e incrementa `attempts` y guarda `lastError` al
 * fallar. Se actualiza fila a fila (no en lote) para que un fallo a mitad de
 * pasada no deje correos enviados pero sin marcar, que es el único error grave
 * posible aquí: reenviar a la gente lo mismo dos veces.
 */
export async function sendPendingNotifications(
  limit = 25,
  now: Date = new Date(),
): Promise<EnvioCorreoResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    const falta = !apiKey ? 'RESEND_API_KEY' : 'EMAIL_FROM';
    // No se lanza: la app tiene que funcionar sin correo configurado.
    console.warn(
      `[email] Envío desactivado: falta ${falta}. Los avisos se quedan en cola.`,
    );
    return {
      enabled: false,
      reason: `Falta ${falta}; los avisos se quedan encolados hasta configurarlo.`,
      sent: 0,
      failed: 0,
      pending: await contarPendientes(),
      dailyRemaining: 0,
    };
  }

  const tope = Number.parseInt(
    process.env.RESEND_DAILY_LIMIT ?? String(TOPE_DIARIO_POR_DEFECTO),
    10,
  );
  const topeDiario = Number.isFinite(tope) && tope > 0 ? tope : TOPE_DIARIO_POR_DEFECTO;

  /**
   * Se cuenta lo ya enviado hoy en lugar de llevar un contador aparte: la
   * propia tabla es la fuente de la verdad y sobrevive a los reinicios de
   * función, que en serverless son constantes.
   */
  const [enviadosHoy] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(gte(notification.sentAt, inicioDelDiaUtc(now)));

  const restantes = Math.max(0, topeDiario - (enviadosHoy?.count ?? 0));

  if (restantes === 0) {
    console.warn(
      `[email] Tope diario alcanzado (${topeDiario}). El resto se enviará mañana.`,
    );
    return {
      enabled: true,
      reason: `Tope diario de ${topeDiario} correos alcanzado; el resto sale mañana.`,
      sent: 0,
      failed: 0,
      pending: await contarPendientes(),
      dailyRemaining: 0,
    };
  }

  const lote = await db
    .select({
      id: notification.id,
      toEmail: notification.toEmail,
      subject: notification.subject,
      body: notification.body,
      attempts: notification.attempts,
    })
    .from(notification)
    .where(and(isNull(notification.sentAt), lt(notification.attempts, MAX_INTENTOS)))
    .orderBy(asc(notification.createdAt))
    .limit(Math.min(limit, restantes));

  if (lote.length === 0) {
    return {
      enabled: true,
      reason: null,
      sent: 0,
      failed: 0,
      pending: 0,
      dailyRemaining: restantes,
    };
  }

  const resend = new Resend(apiKey);
  let sent = 0;
  let failed = 0;

  for (const [indice, aviso] of lote.entries()) {
    if (indice > 0) await sleep(PAUSA_ENTRE_ENVIOS_MS);

    let error: string | null = null;
    try {
      const respuesta = await resend.emails.send({
        from,
        to: [aviso.toEmail],
        subject: aviso.subject,
        text: componerTexto(aviso.body),
      });
      if (respuesta.error) {
        error = `${respuesta.error.name}: ${respuesta.error.message}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    if (error) {
      failed += 1;
      await db
        .update(notification)
        .set({ attempts: aviso.attempts + 1, lastError: error.slice(0, 500) })
        .where(eq(notification.id, aviso.id));
      /**
       * Se registra el id de la fila, NUNCA la dirección. Los registros de
       * Vercel los ve cualquiera con acceso al proyecto y aquí las direcciones
       * son de tiradores y de tutores de menores. Con el id se localiza la
       * fila en `notification` y ahí está el destinatario, con el control de
       * acceso de la base de datos delante.
       */
      console.error(`[email] Fallo al enviar el aviso ${aviso.id}: ${error}`);
      continue;
    }

    sent += 1;
    await db
      .update(notification)
      .set({ sentAt: new Date(), attempts: aviso.attempts + 1, lastError: null })
      .where(eq(notification.id, aviso.id));
  }

  return {
    enabled: true,
    reason: null,
    sent,
    failed,
    pending: await contarPendientes(),
    dailyRemaining: Math.max(0, restantes - sent),
  };
}

/**
 * Estado de la configuración de correo, para poder enseñarlo en el panel de
 * admin sin tener que intentar un envío.
 */
export function emailStatus(): { enabled: boolean; reason: string | null } {
  if (!process.env.RESEND_API_KEY) {
    return { enabled: false, reason: 'Falta RESEND_API_KEY.' };
  }
  if (!process.env.EMAIL_FROM) {
    return { enabled: false, reason: 'Falta EMAIL_FROM (remitente verificado).' };
  }
  return { enabled: true, reason: null };
}
