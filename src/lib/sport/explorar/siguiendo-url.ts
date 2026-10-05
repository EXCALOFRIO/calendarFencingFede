import { LONGITUD_MAXIMA_CURSOR } from './favoritos-url';
import { RUTA_EXPLORAR } from './url';

/**
 * Feed «Siguiendo», bajo Explorar. La URL sólo lleva el cursor y el filtro de
 * medallas; la cuenta sale siempre de la sesión y el cursor queda ligado a
 * ella y al filtro.
 */
export const RUTA_SIGUIENDO = `${RUTA_EXPLORAR}/siguiendo`;

export type CriteriosSiguiendo = { cursor: string; soloMedallas: boolean };

type Parametros = Record<string, string | string[] | undefined>;

const primero = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor) ?? '';

export function leerCriteriosSiguiendo(params: Parametros): CriteriosSiguiendo {
  return {
    cursor: primero(params.cursor).trim().slice(0, LONGITUD_MAXIMA_CURSOR),
    soloMedallas: primero(params.medallas) === '1',
  };
}

export function construirUrlSiguiendo(c: Partial<CriteriosSiguiendo> = {}): string {
  const params = new URLSearchParams();
  if (c.soloMedallas) params.set('medallas', '1');
  if (c.cursor) params.set('cursor', c.cursor);
  const texto = params.toString();
  return texto ? `${RUTA_SIGUIENDO}?${texto}` : RUTA_SIGUIENDO;
}
