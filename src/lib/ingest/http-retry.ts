/**
 * `Retry-After` de una respuesta HTTP y su paso por los mensajes de error.
 *
 * Los lectores guardan el motivo de un fallo como texto (cobertura, resultado
 * de lectura), así que el valor real del encabezado viaja dentro del mensaje
 * (`HTTP 429 … (Retry-After: 12s)`) y quien clasifica el fallo lo recupera. Así
 * el orquestador espera lo que pidió la fuente (acotado por su propio tope) y
 * no un retroceso fijo.
 */

/** Tope de lo que se acepta de un `Retry-After`: una fuente no fija la espera de un lote. */
export const RETRY_AFTER_MAX_MS = 10 * 60_000;

/** Segundos enteros o fecha HTTP; cualquier otra cosa es `null`. */
export function parsearRetryAfter(valor: string | null | undefined, ahora: number = Date.now()): number | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (/^\d+$/.test(texto)) return Math.min(Number(texto) * 1000, RETRY_AFTER_MAX_MS);
  const fecha = Date.parse(texto);
  if (Number.isNaN(fecha)) return null;
  return Math.min(Math.max(0, fecha - ahora), RETRY_AFTER_MAX_MS);
}

export function sufijoRetryAfter(ms: number | null | undefined): string {
  return ms === null || ms === undefined || !Number.isFinite(ms) ? '' : ` (Retry-After: ${Math.ceil(ms / 1000)}s)`;
}

export function retryAfterDeTexto(texto: string): number | null {
  const m = texto.match(/Retry-After:\s*(\d+)s/i);
  return m ? Math.min(Number(m[1]) * 1000, RETRY_AFTER_MAX_MS) : null;
}

/** `HTTP 429` con el `Retry-After` real si la respuesta lo trajo. */
export const motivoHttp = (status: number, retryAfterMs?: number | null, detalle = ''): string =>
  `HTTP ${status}${detalle}${sufijoRetryAfter(retryAfterMs)}`;

export class ErrorHttp extends Error {
  constructor(
    mensaje: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(mensaje);
    this.name = 'ErrorHttp';
  }
}
