import { UUID_RE } from './cursor';
import { RUTA_EXPLORAR } from './url';

/**
 * Criterios de la ficha deportiva en la URL: temporada del ranking oficial,
 * modalidad y cursor del historial. La misma lectura sirve a la ficha de
 * cualquier persona y al historial propio de `/perfil`, que sólo cambia la
 * ruta base.
 */

export type CriteriosFicha = {
  /** Temporada del ranking oficial tal y como se guarda (FIE `AAAA`, RFEE `AAAA-AAAA`). */
  ranking: string;
  formato: '' | 'INDIVIDUAL' | 'EQUIPOS';
  cursor: string;
};

export const CRITERIOS_FICHA_VACIOS: CriteriosFicha = { ranking: '', formato: '', cursor: '' };

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return ((Array.isArray(valor) ? valor[0] : valor) ?? '').trim();
}

export function leerCriteriosFicha(params: Parametros): CriteriosFicha {
  const formato = primero(params.formato).toUpperCase();
  return {
    ranking: primero(params.ranking).slice(0, 12),
    formato: formato === 'INDIVIDUAL' || formato === 'EQUIPOS' ? formato : '',
    cursor: primero(params.cursor).slice(0, 600),
  };
}

/** Entrada de `leerFicha`: sólo lo rellenado. */
export function aEntradaFicha(
  personaId: string | undefined,
  c: CriteriosFicha,
): Record<string, string> {
  const entrada: Record<string, string> = {};
  if (personaId) entrada.personaId = personaId;
  if (c.ranking) entrada.temporadaRanking = c.ranking;
  if (c.formato) entrada.formato = c.formato;
  return entrada;
}

/**
 * URL de una vista de la ficha. Cambiar temporada o modalidad cambia el
 * ranking, no el historial, pero el cursor del historial se descarta siempre
 * que cambia algo: nunca se arrastra a otra consulta.
 */
export function construirUrlFicha(
  base: string,
  c: Partial<CriteriosFicha>,
  ancla?: string,
): string {
  const params = new URLSearchParams();
  if (c.ranking) params.set('ranking', c.ranking);
  if (c.formato) params.set('formato', c.formato);
  if (c.cursor) params.set('cursor', c.cursor);
  const texto = params.toString();
  return `${base}${texto ? `?${texto}` : ''}${ancla ? `#${ancla}` : ''}`;
}

/** Ruta de otra persona, o `null` si el segmento no es un identificador. */
export function personaDeRuta(segmento: string): string | null {
  return UUID_RE.test(segmento) ? segmento.toLowerCase() : null;
}

export const RUTA_PERFIL = '/perfil';
export { RUTA_EXPLORAR };
