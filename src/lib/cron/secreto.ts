import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Comprobación del `Authorization: Bearer $CRON_SECRET` de las rutas de cron.
 *
 * Se compara en tiempo constante: se pasan los dos valores por HMAC-SHA256
 * con una clave aleatoria del proceso (así los dos resúmenes miden siempre 32
 * bytes, sea cual sea la longitud de lo recibido) y se comparan con
 * `timingSafeEqual`. Un `!==` de cadenas termina en el primer carácter
 * distinto, y eso deja medir cuánto del secreto se ha acertado.
 */
const CLAVE = randomBytes(32);

function resumen(valor: string): Buffer {
  return createHmac('sha256', CLAVE).update(valor).digest();
}

export function secretoCronValido(cabecera: string | null, secreto: string): boolean {
  return timingSafeEqual(resumen(cabecera ?? ''), resumen(`Bearer ${secreto}`));
}

export type EstadoCron = 'autorizado' | 'sin_secreto' | 'no_autorizado';

/**
 * `sin_secreto` sólo se trata como autorizado si quien llama lo permite (las
 * rutas de ingestión, en desarrollo, para poder probarlas con curl).
 */
export function estadoCron(request: Request, secreto = process.env.CRON_SECRET): EstadoCron {
  if (!secreto?.trim()) return 'sin_secreto';
  return secretoCronValido(request.headers.get('authorization'), secreto) ? 'autorizado' : 'no_autorizado';
}

/**
 * La guarda común de /api/cron/ingest, /api/cron/notify y /api/cron/extraer:
 * `null` si se puede seguir, o la respuesta de rechazo. Sin secreto, en
 * producción responde 503 (nunca se abre); en desarrollo deja pasar.
 */
export function autorizarCron(request: Request): Response | null {
  const estado = estadoCron(request);
  if (estado === 'autorizado') return null;
  if (estado === 'sin_secreto') {
    if (process.env.NODE_ENV !== 'production') return null;
    return Response.json(
      {
        ok: false,
        error: 'Falta CRON_SECRET en el entorno. Defínela en el Worker para que el cron pueda ejecutarse.',
      },
      { status: 503 },
    );
  }
  return Response.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
}
