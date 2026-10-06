import { sanitizarRetornoCalendario } from '@/lib/calendario/contexto-url';
import { RUTA_EDICIONES, sanitizarRetornoCatalogo } from './catalogo-url';
import { UUID_RE } from './cursor';
import { CRITERIOS_VACIOS, construirUrl, type CriteriosExplorar } from './url';

/**
 * Direcciones de las páginas de edición. Sin imports de servidor: las usan la
 * página, el calendario (cliente) y el saneado del retorno de la ficha.
 */

export { RUTA_EDICIONES } from './catalogo-url';

const LONGITUD_MAXIMA_CURSOR = 600;

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return ((Array.isArray(valor) ? valor[0] : valor) ?? '').trim();
}

export type CriteriosEdicion = {
  /** Prueba de la edición cuya clasificación se enseña, o vacío. */
  prueba: string;
  cursor: string;
  /**
   * Calendario del que se llegó, ya saneado, con su periodo y filtros. Sólo
   * está si se llegó desde el calendario; viaja por edición → persona → atrás.
   */
  origen?: string;
  /** Búsqueda del catálogo de origen, con filtros y página ya saneados. */
  catalogo?: string;
  /** Persona deportiva que se resalta (y a la que se lleva) en las tres vistas. */
  persona?: string;
  /** Vista de la prueba con la que se abre la página. */
  vista?: VistaPrueba;
};

export const VISTAS_PRUEBA = ['clasificacion', 'poules', 'directas'] as const;
export type VistaPrueba = (typeof VISTAS_PRUEBA)[number];

function esVista(valor: string): valor is VistaPrueba {
  return (VISTAS_PRUEBA as readonly string[]).includes(valor);
}

export const CRITERIOS_EDICION_VACIOS: CriteriosEdicion = { prueba: '', cursor: '' };

export function rutaEdicion(edicionId: string): string {
  return `${RUTA_EDICIONES}/${edicionId}`;
}

/** Edición de un segmento de ruta, o `null` si no es un identificador. */
export function edicionDeRuta(segmento: string): string | null {
  return UUID_RE.test(segmento) ? segmento.toLowerCase() : null;
}

export function leerCriteriosEdicion(params: Parametros): CriteriosEdicion {
  const prueba = primero(params.prueba);
  const origen = sanitizarRetornoCalendario(primero(params.origen));
  const catalogo = sanitizarRetornoCatalogo(primero(params.catalogo));
  const persona = primero(params.persona);
  const vista = primero(params.vista);
  return {
    prueba: UUID_RE.test(prueba) ? prueba.toLowerCase() : '',
    cursor: primero(params.cursor).slice(0, LONGITUD_MAXIMA_CURSOR),
    ...(origen ? { origen } : {}),
    ...(catalogo ? { catalogo } : {}),
    ...(UUID_RE.test(persona) ? { persona: persona.toLowerCase() } : {}),
    ...(esVista(vista) ? { vista } : {}),
  };
}

/**
 * Cambiar de prueba cambia la consulta: el cursor nunca viaja a otra
 * clasificación. El origen del calendario sí viaja siempre: no es parte de la consulta.
 * La vista por defecto (clasificación) no se escribe.
 */
export function construirUrlEdicion(edicionId: string, c: Partial<CriteriosEdicion> = {}): string {
  const params = new URLSearchParams();
  if (c.prueba) params.set('prueba', c.prueba);
  if (c.cursor) params.set('cursor', c.cursor);
  if (c.vista && c.vista !== 'clasificacion' && esVista(c.vista)) params.set('vista', c.vista);
  if (c.persona && UUID_RE.test(c.persona)) params.set('persona', c.persona.toLowerCase());
  const origen = sanitizarRetornoCalendario(c.origen);
  if (origen) params.set('origen', origen);
  const catalogo = sanitizarRetornoCatalogo(c.catalogo);
  if (catalogo) params.set('catalogo', catalogo);
  const texto = params.toString();
  return `${rutaEdicion(edicionId)}${texto ? `?${texto}` : ''}`;
}

/**
 * Retorno a una página de edición (o a su índice) desde una ficha. Es un valor
 * de la URL y no se fía: sólo vale el índice, o una edición con su prueba y
 * cursor, reconstruidos con las claves conocidas. Otra cosa da `''`.
 */
export function sanitizarRetornoEdicion(crudo: string): string {
  if (crudo === RUTA_EDICIONES || crudo.startsWith(`${RUTA_EDICIONES}?`)) return sanitizarRetornoCatalogo(crudo);
  if (!crudo.startsWith(`${RUTA_EDICIONES}/`)) return '';
  const resto = crudo.slice(RUTA_EDICIONES.length + 1);
  const corte = resto.search(/[?]/);
  const segmento = corte === -1 ? resto : resto.slice(0, corte);
  const edicion = edicionDeRuta(segmento);
  if (!edicion) return '';
  const consulta = new URLSearchParams(corte === -1 ? '' : resto.slice(corte + 1));
  const criterios = leerCriteriosEdicion({
    prueba: consulta.get('prueba') ?? undefined,
    cursor: consulta.get('cursor') ?? undefined,
    origen: consulta.get('origen') ?? undefined,
    catalogo: consulta.get('catalogo') ?? undefined,
    persona: consulta.get('persona') ?? undefined,
    vista: consulta.get('vista') ?? undefined,
  });
  return construirUrlEdicion(edicion, criterios);
}

export type PruebaParaExplorar = {
  arma: string;
  genero: string;
  categoria: { codigo: string; raw: string | null };
  formato: string;
};

const LONGITUD_MAXIMA_CRITERIO = 40;

/**
 * Explorar de los deportistas de UNA prueba. La categoría viaja con el literal
 * de la fuente cuando el filtro de la URL lo reproduce tal cual; si el literal
 * no sobrevive a la normalización de espacios o excede el límite, viaja el
 * código de la aplicación en lugar de un filtro que no coincidiría con nada.
 */
export function urlExplorarDePrueba(edicionId: string, p: PruebaParaExplorar): string {
  const raw = p.categoria.raw;
  const rawUsable =
    raw !== null &&
    raw !== '' &&
    raw === raw.replace(/\s+/g, ' ').trim() &&
    raw.length <= LONGITUD_MAXIMA_CRITERIO;
  const criterios: CriteriosExplorar = {
    ...CRITERIOS_VACIOS,
    edicionId,
    arma: p.arma,
    genero: p.genero,
    formato: p.formato,
    categoriaRaw: rawUsable ? (raw ?? '') : '',
    categoria: rawUsable ? '' : p.categoria.codigo,
  };
  return construirUrl(criterios);
}
