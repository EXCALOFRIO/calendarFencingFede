import { UUID_RE } from './cursor';
import { CRITERIOS_VACIOS, RUTA_EXPLORAR, construirUrl, type CriteriosExplorar } from './url';

/**
 * Direcciones de las páginas de edición. Sin imports de servidor: las usan la
 * página, el calendario (cliente) y el saneado del retorno de la ficha.
 */

export const RUTA_EDICIONES = `${RUTA_EXPLORAR}/ediciones`;

const LONGITUD_MAXIMA_CURSOR = 600;

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return ((Array.isArray(valor) ? valor[0] : valor) ?? '').trim();
}

export type CriteriosEdicion = {
  /** Prueba de la edición cuya clasificación se enseña, o vacío. */
  prueba: string;
  cursor: string;
};

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
  return {
    prueba: UUID_RE.test(prueba) ? prueba.toLowerCase() : '',
    cursor: primero(params.cursor).slice(0, LONGITUD_MAXIMA_CURSOR),
  };
}

/** Cambiar de prueba cambia la consulta: el cursor nunca viaja a otra clasificación. */
export function construirUrlEdicion(edicionId: string, c: Partial<CriteriosEdicion> = {}): string {
  const params = new URLSearchParams();
  if (c.prueba) params.set('prueba', c.prueba);
  if (c.cursor) params.set('cursor', c.cursor);
  const texto = params.toString();
  return `${rutaEdicion(edicionId)}${texto ? `?${texto}` : ''}`;
}

/**
 * Retorno a una página de edición (o a su índice) desde una ficha. Es un valor
 * de la URL y no se fía: sólo vale el índice, o una edición con su prueba y
 * cursor, reconstruidos con las claves conocidas. Otra cosa da `''`.
 */
export function sanitizarRetornoEdicion(crudo: string): string {
  if (crudo === RUTA_EDICIONES || crudo.startsWith(`${RUTA_EDICIONES}?`)) return RUTA_EDICIONES;
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
