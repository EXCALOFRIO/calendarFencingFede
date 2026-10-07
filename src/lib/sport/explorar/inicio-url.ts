import { RUTA_EXPLORAR } from './url';
import type { CriteriosSiguiendo } from './siguiendo-url';

/**
 * Inicio de Explorar: el feed con los últimos resultados de las personas que
 * sigue la cuenta. Vive en `/explorar` a secas; la URL sólo lleva el filtro de
 * medallas y el cursor, que queda ligado a la cuenta y al filtro.
 */
export const RUTA_INICIO = RUTA_EXPLORAR;

/** «Tú» de la barra: lleva a la ficha propia si está confirmada, o a la cuenta. */
export const RUTA_YO = `${RUTA_EXPLORAR}/yo`;

export function construirUrlInicio(c: Partial<CriteriosSiguiendo> = {}): string {
  const params = new URLSearchParams();
  if (c.soloMedallas) params.set('medallas', '1');
  if (c.cursor) params.set('cursor', c.cursor);
  const texto = params.toString();
  return texto ? `${RUTA_INICIO}?${texto}` : RUTA_INICIO;
}
