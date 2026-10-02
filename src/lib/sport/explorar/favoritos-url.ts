import { RUTA_EXPLORAR } from './url';

/**
 * Lista propia de favoritos, bajo Explorar: no es un destino más de la barra,
 * así que Explorar sigue marcado como sección activa. El único criterio de la
 * URL es el cursor de página; la cuenta sale siempre de la sesión.
 */

export const RUTA_FAVORITOS = `${RUTA_EXPLORAR}/favoritos`;

export const LONGITUD_MAXIMA_CURSOR = 600;

type Parametros = Record<string, string | string[] | undefined>;

export function leerCursorFavoritos(params: Parametros): string {
  const valor = params.cursor;
  return ((Array.isArray(valor) ? valor[0] : valor) ?? '').trim().slice(0, LONGITUD_MAXIMA_CURSOR);
}

export function construirUrlFavoritos(cursor?: string): string {
  return cursor ? `${RUTA_FAVORITOS}?${new URLSearchParams({ cursor }).toString()}` : RUTA_FAVORITOS;
}
