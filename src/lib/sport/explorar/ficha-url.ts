import { UUID_RE } from './cursor';
import { RUTA_EDICIONES, sanitizarRetornoEdicion } from './edicion-url';
import { LONGITUD_MAXIMA_CURSOR, RUTA_FAVORITOS, construirUrlFavoritos } from './favoritos-url';
import type { AmbitoCompeticion } from './tipos-social';
import { CLAVES_CRITERIO, RUTA_EXPLORAR, construirUrl, leerCriterios, rutaFicha } from './url';

/**
 * Criterios de la ficha deportiva en la URL: temporada del ranking oficial,
 * modalidad y cursor del historial, más la búsqueda de Explorar a la que se
 * vuelve. La misma lectura sirve a la ficha de cualquier persona y al historial propio de `/perfil`, que sólo cambia la
 * ruta base.
 */

export type CriteriosFicha = {
  /** Temporada del ranking oficial tal y como se guarda (FIE `AAAA`, RFEE `AAAA-AAAA`). */
  ranking: string;
  formato: '' | 'INDIVIDUAL' | 'EQUIPOS';
  cursor: string;
  /** Búsqueda de Explorar de la que se llegó (ya saneada), o vacío en entrada directa. */
  volver: string;
  /** Ámbito de la pestaña Resultados; ausente = todo. */
  ambito?: AmbitoCompeticion;
  /** Resultados del historial completo a la vista («Ver más»); ausente = la primera tanda. */
  ver?: number;
};

export const CRITERIOS_FICHA_VACIOS: CriteriosFicha = { ranking: '', formato: '', cursor: '', volver: '' };

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return ((Array.isArray(valor) ? valor[0] : valor) ?? '').trim();
}

/** Cabe una edición con prueba, cursor y el origen del calendario codificado dentro. */
const LONGITUD_MAXIMA_RETORNO = 2400;

/**
 * Búsqueda de Explorar, página de favoritos o página de edición a la que
 * volver desde una ficha. El valor viaja en la URL, así que no se fía: sólo
 * vale `/explorar` con su consulta, `/explorar/favoritos` con su cursor o
 * `/explorar/ediciones[/id]` con su prueba y cursor, y se
 * reconstruye con las claves que cada pantalla conoce. Un esquema, un host,
 * otra ruta, un fragmento o una barra invertida dan vacío, y vacío significa
 * volver a `/explorar` a secas.
 */
export function sanitizarRetorno(valor: string | undefined): string {
  const crudo = (valor ?? '').trim();
  if (!crudo || crudo.length > LONGITUD_MAXIMA_RETORNO) return '';
  if (/[\u0000-\u001f\u007f\\]/.test(crudo)) return '';
  if (crudo === RUTA_FAVORITOS || crudo.startsWith(`${RUTA_FAVORITOS}?`)) {
    const cursor = new URLSearchParams(crudo.slice(RUTA_FAVORITOS.length + 1)).get('cursor') ?? '';
    return cursor.length > LONGITUD_MAXIMA_CURSOR ? '' : construirUrlFavoritos(cursor.trim());
  }
  if (crudo === RUTA_EDICIONES || crudo.startsWith(`${RUTA_EDICIONES}/`) || crudo.startsWith(`${RUTA_EDICIONES}?`)) {
    return sanitizarRetornoEdicion(crudo);
  }
  if (crudo !== RUTA_EXPLORAR && !crudo.startsWith(`${RUTA_EXPLORAR}?`)) return '';

  const consulta = new URLSearchParams(crudo.slice(RUTA_EXPLORAR.length + 1));
  const params: Record<string, string> = {};
  for (const clave of [...CLAVES_CRITERIO, 'cursor']) {
    const v = consulta.get(clave);
    if (v !== null) params[clave] = v;
  }
  const { criterios, cursor } = leerCriterios(params);
  return construirUrl(criterios, cursor);
}

export function leerCriteriosFicha(params: Parametros): CriteriosFicha {
  const formato = primero(params.formato).toUpperCase();
  const ambito = primero(params.ambito).toLowerCase();
  const ver = /^\d{1,4}$/.test(primero(params.ver)) ? Number(primero(params.ver)) : 0;
  return {
    ranking: primero(params.ranking).slice(0, 12),
    formato: formato === 'INDIVIDUAL' || formato === 'EQUIPOS' ? formato : '',
    cursor: primero(params.cursor).slice(0, 600),
    volver: sanitizarRetorno(primero(params.volver)),
    ...(ambito === 'internacional' || ambito === 'nacional' ? { ambito } : {}),
    ...(ver > 0 ? { ver } : {}),
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
  if (c.ambito) params.set('ambito', c.ambito);
  if (c.ver) params.set('ver', String(c.ver));
  if (c.volver) params.set('volver', c.volver);
  const texto = params.toString();
  return `${base}${texto ? `?${texto}` : ''}${ancla ? `#${ancla}` : ''}`;
}

/**
 * Ficha de una persona abierta desde una búsqueda de Explorar: la dirección
 * lleva la búsqueda (filtros y página) para poder volver a ella. Sin
 * búsqueda, o con un retorno no válido, es la ruta desnuda.
 */
export function rutaFichaConRetorno(personaId: string, volver: string): string {
  const retorno = sanitizarRetorno(volver);
  return retorno && retorno !== RUTA_EXPLORAR
    ? construirUrlFicha(rutaFicha(personaId), { volver: retorno })
    : rutaFicha(personaId);
}

/** Ruta de otra persona, o `null` si el segmento no es un identificador. */
export function personaDeRuta(segmento: string): string | null {
  return UUID_RE.test(segmento) ? segmento.toLowerCase() : null;
}

export const RUTA_PERFIL = '/perfil';
export { RUTA_EXPLORAR };
