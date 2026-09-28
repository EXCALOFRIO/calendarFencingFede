/**
 * Conversión entre lo que se escribe en pantalla y lo que se guarda.
 *
 * Los campos de fecha y hora de la app producen `YYYY-MM-DDTHH:mm` pensando en
 * hora española, que es la que tiene en la cabeza quien administra esto. La
 * base guarda `timestamptz`, o sea instantes absolutos. Si se convirtiera con
 * `new Date(texto)` el resultado dependería del huso del servidor (en Vercel,
 * UTC), y en verano un plazo escrito a las 23:59 se guardaría como las 01:59
 * del día siguiente. Por eso se calcula el desfase real de Europe/Madrid para
 * ese instante concreto, cambio de hora incluido.
 */

const MADRID = 'Europe/Madrid';

function desfaseMadridMinutos(instante: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: MADRID,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const v = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? '0');

  const comoUtc = Date.UTC(
    v('year'),
    v('month') - 1,
    v('day'),
    v('hour') % 24,
    v('minute'),
    v('second'),
  );

  return (comoUtc - instante.getTime()) / 60_000;
}

/** `YYYY-MM-DDTHH:mm` (hora de Madrid) -> instante absoluto. */
export function parseFechaMadrid(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const limpio = valor.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(limpio)) {
    // Solo fecha: se toma el final del día, que es lo que significa un plazo.
    if (/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return parseFechaMadrid(`${limpio}T23:59`);
    return null;
  }

  const provisional = new Date(`${limpio.slice(0, 16)}:00Z`);
  if (Number.isNaN(provisional.getTime())) return null;

  // Doble pasada: el desfase se calcula sobre el instante ya corregido, para
  // que las fechas de la madrugada del cambio de hora no se vayan una hora.
  const primera = new Date(
    provisional.getTime() - desfaseMadridMinutos(provisional) * 60_000,
  );
  return new Date(provisional.getTime() - desfaseMadridMinutos(primera) * 60_000);
}

/** Instante -> `YYYY-MM-DDTHH:mm` en hora de Madrid, para rellenar el campo. */
export function toCampoFechaHora(valor: Date | null | undefined): string {
  if (!valor) return '';
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: MADRID,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(valor);
  // 'sv-SE' formatea como "2026-09-25 23:59", que es casi lo que hace falta.
  return partes.replace(' ', 'T');
}

/** Instante -> `YYYY-MM-DD` en hora de Madrid. */
export function toCampoFecha(valor: Date | null | undefined): string {
  return toCampoFechaHora(valor).slice(0, 10);
}

/**
 * Hoy en España, `YYYY-MM-DD`. **Nunca `new Date().getDate()`.**
 *
 * El calendario resalta el día de hoy, la agenda lo separa y «lo que viene»
 * cuenta los días que faltan. Los tres lo calculaban con las partes locales de
 * `new Date()`, y ahí el huso del que ejecuta decide: **el Worker de
 * Cloudflare corre en UTC y el navegador en hora española**, así que entre las
 * 00:00 y las 02:00 de Madrid el servidor pinta un día y el navegador otro.
 *
 * Eso se veía de dos maneras. Como error de hidratación de React en
 * producción —el texto del servidor no coincide con el del cliente, y React
 * rehace ese trozo del árbol ya pintado, que es de donde salen los saltos de
 * maquetación tardíos— y como un fallo de bulto: a la una de la mañana el
 * calendario resaltaba ayer y el plazo decía un día más de los que quedaban.
 *
 * Se ancla a España porque es la referencia de la federación: si alguien lo
 * abre desde Tokio en una Copa del Mundo, las fechas que le importan siguen
 * siendo las de la convocatoria española.
 */
export function hoyMadrid(): string {
  return toCampoFecha(new Date());
}
