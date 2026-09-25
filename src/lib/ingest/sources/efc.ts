import { fetchText } from '../fetcher';

/**
 * Adaptador de la EFC (Confederación Europea de Esgrima).
 *
 * -------------------------------------------------------------------------
 * ESTADO REAL, comprobado el 25/09/2026: la fuente no existe ahora mismo
 * -------------------------------------------------------------------------
 * `eurofencing.info` devuelve NXDOMAIN en 8.8.8.8 y en 1.1.1.1. No es un
 * problema de red nuestro: el RDAP del registrador dice
 * `expiration: 2026-08-06` y `status: redemption period`, es decir, dominio
 * expirado y retirado de la zona DNS. Tampoco hay dominio alternativo
 * (`europeanfencing.info/.org`, `eurofencing.net/.com` -> NXDOMAIN).
 *
 * Y aunque vuelva: la evidencia apunta a que la EFC publicaba su calendario
 * como PDF adjunto (`/getFile/case:show/id:<ID>`), no como tabla HTML
 * parseable. Es decir, ni siquiera recuperado sería scrapeable sin leer PDFs.
 *
 * -------------------------------------------------------------------------
 * Y por qué esto NO es un agujero en el producto
 * -------------------------------------------------------------------------
 * El circuito europeo ya entra por Skermo: en el calendario de la RFEE
 * aparecen "Circuito Cadete Europeo" (48 pruebas), "Circuito Europeo M14"
 * (77), "Circuito Sub23 Europeo" (30) y "EFC Eurofence league" (30). O sea,
 * la RFEE republica lo que le interesa al tirador español, que es justo
 * nuestro caso de uso.
 *
 * Así que este adaptador existe para (a) dejar constancia de que se intentó,
 * (b) volver a probar todos los días sin coste, y (c) estar listo el día que
 * el dominio vuelva. Mientras tanto NO inventa nada: informa de que la fuente
 * no está disponible, y eso sale en el panel de admin como tal.
 */

export const EFC_CANDIDATE_URLS = [
  'https://www.eurofencing.info/competitions/championships',
  'https://eurofencing.info/competitions/championships',
];

export type EfcOutcome = {
  candidates: unknown[];
  rowsSeen: number;
  /** Mensaje para el panel de admin cuando la fuente no responde. */
  unavailableReason: string | null;
};

/**
 * Intenta leer el calendario de la EFC.
 *
 * No lanza cuando el dominio no resuelve: devuelve `unavailableReason`, que el
 * runner registra como ejecución "parcial" en vez de como error. La diferencia
 * importa: un error hace saltar la alerta de scraper roto, y aquí no hay nada
 * roto por nuestra parte, simplemente la fuente no existe.
 */
export async function fetchEfcCalendar(): Promise<EfcOutcome> {
  const errors: string[] = [];

  for (const url of EFC_CANDIDATE_URLS) {
    try {
      const { body } = await fetchText(url, { timeoutMs: 20_000, retries: 0 });
      // Si algún día responde, aquí irá el parseo. Hasta entonces no se
      // escribe un parser a ciegas contra un HTML que nadie ha visto: sería
      // código que nunca se ha ejecutado fingiendo que funciona.
      return {
        candidates: [],
        rowsSeen: 0,
        unavailableReason:
          `La web de la EFC vuelve a responder (${url}, ${body.length} bytes). ` +
          'Hay que escribir el parseo contra su marcado real antes de ingerir nada.',
      };
    } catch (error) {
      errors.push(
        `${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    candidates: [],
    rowsSeen: 0,
    unavailableReason:
      'La web de la EFC no está accesible (dominio eurofencing.info expirado el ' +
      '06/08/2026 y retirado del DNS). El circuito europeo se sigue viendo, ' +
      'porque la RFEE lo republica en su propio calendario de Skermo. ' +
      `Detalle: ${errors.join(' | ')}`,
  };
}
