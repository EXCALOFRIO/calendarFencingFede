import { fetchJson } from '@/lib/ingest/fetcher';
import {
  fieEntriesApiUrl,
  inscritosDeLaFie,
  type InscritoFiePublico,
} from '@/lib/ingest/sources/fie';

export type { InscritoFiePublico } from '@/lib/ingest/sources/fie';

/**
 * Lo que responde `/api/inscritos-fie` cuando la petición a la FIE salió bien
 * o dijo «eso no existe»:
 *
 *  - `ok` — la lista completa ya saneada (`inscritosDeLaFie`) y `total`, el
 *    `totalFound` que publica la FIE. `total` puede ser MAYOR que
 *    `inscritos.length`: la lista se pide con el tope de la ingestión
 *    (`TOPE_INSCRITOS`, 200) y si algún día una prueba lo pasa, la respuesta
 *    lo dice en vez de fingir que la lista es entera.
 *  - `sin_lista` — la API de la FIE contestó 404: la prueba no existe en su
 *    calendario o todavía no ha abierto la inscripción. NO es un error de
 *    transporte: es una respuesta con un mensaje honesto en la ficha.
 */
export type ListaFie =
  | { estado: 'ok'; total: number; inscritos: InscritoFiePublico[] }
  | { estado: 'sin_lista' };

/**
 * Pide a la FIE la lista de una prueba, de TODOS los países.
 *
 * La lista local de la base sólo guarda españoles (ver la nota «LA LISTA DE
 * INSCRITOS» de `sources/fie.ts`); esta lectura en vivo es la que permite
 * enseñar la completa en la ficha sin copiar nada a D1. Es la misma API que
 * lee la ingestión, con el mismo tope, y se sirve detrás de la caché
 * compartida para que cien aperturas de la misma ficha no sean cien viajes a
 * fie.org.
 *
 * Timeout corto y sin reintento: quien espera es una persona con la ficha
 * abierta, no el cron de la noche. Si la FIE falla, la ficha dice «no se pudo
 * leer» y se reintenta a mano.
 *
 * Lanza ante errores de red y estados distintos de 404: el `sin_lista` de
 * arriba es sólo para el «todavía no publicada», que sí es una respuesta.
 */
export async function leerInscritosFie(
  temporada: number,
  competicion: number,
): Promise<ListaFie> {
  let payload: unknown;
  try {
    payload = await fetchJson<unknown>(fieEntriesApiUrl(temporada, competicion), {
      timeoutMs: 10_000,
      retries: 0,
    });
  } catch (error) {
    /*
      `fetchJson` envuelve el `ErrorHttp` en un `Error` plano («No se pudo
      leer …: HTTP 404 al pedir …»), así que el estado sólo sobrevive en el
      mensaje —el mismo criterio que `retryAfterDeTexto` para recuperar lo que
      la fuente dijo.
    */
    if (error instanceof Error && /\bHTTP 404\b/.test(error.message)) {
      return { estado: 'sin_lista' };
    }
    throw error;
  }

  const inscritos = inscritosDeLaFie(payload);
  const publicado =
    payload && typeof payload === 'object'
      ? Number((payload as { totalFound?: unknown }).totalFound ?? 0)
      : 0;
  const total = Number.isFinite(publicado) ? publicado : 0;

  return {
    estado: 'ok',
    // Si el total viniera mal (o la API lo cambiara), al menos no dice menos
    // que las filas que sí se han leído.
    total: Math.max(total, inscritos.length),
    inscritos,
  };
}
