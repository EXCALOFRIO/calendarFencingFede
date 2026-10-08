import { RUTA_EXPLORAR } from './url';

export const RUTA_EDICIONES = `${RUTA_EXPLORAR}/ediciones`;

export const FUENTES_CATALOGO = [
  { valor: 'fie', etiqueta: 'Internacional' },
  { valor: 'efc', etiqueta: 'Europeo' },
  { valor: 'skermo_rfee', etiqueta: 'Nacional' },
  { valor: 'rfee_pdf', etiqueta: 'Nacional (PDF)' },
  { valor: 'engarde', etiqueta: 'Engarde' },
] as const;

/**
 * El orden es el de la URL. `desde` y `hasta` son años; `temporada` sigue
 * valiendo en enlaces antiguos. `genero` y `formato` van al final para que las
 * direcciones que ya existían no cambien.
 */
export const CLAVES_CATALOGO = ['q', 'fuente', 'arma', 'categoria', 'desde', 'hasta', 'temporada', 'genero', 'formato'] as const;
export type ClaveCatalogo = (typeof CLAVES_CATALOGO)[number];
export type CriteriosCatalogo = Record<ClaveCatalogo, string>;

export const CRITERIOS_CATALOGO_VACIOS: CriteriosCatalogo = {
  q: '', fuente: '', arma: '', categoria: '', desde: '', hasta: '', temporada: '', genero: '', formato: '',
};

/** Los filtros (todo menos el texto), vacíos: «Quitar filtros». */
export const SIN_FILTROS_CATALOGO: Omit<CriteriosCatalogo, 'q'> = {
  fuente: '', arma: '', categoria: '', desde: '', hasta: '', temporada: '', genero: '', formato: '',
};

export const GENEROS_CATALOGO = ['M', 'F', 'MIXTO'] as const;
export const FORMATOS_CATALOGO = ['INDIVIDUAL', 'EQUIPOS'] as const;

/** Cuántos filtros hay puestos, como los cuenta el botón «Filtros (N)»: las fechas cuentan uno. */
export function cuantosFiltrosCatalogo(criterios: CriteriosCatalogo): number {
  return (['fuente', 'arma', 'genero', 'formato', 'categoria', 'temporada'] as const).filter((k) => criterios[k]).length
    + (criterios.desde || criterios.hasta ? 1 : 0);
}

const LIMITES: Record<ClaveCatalogo, number> = {
  q: 100, fuente: 40, arma: 10, categoria: 10, desde: 4, hasta: 4, temporada: 9, genero: 10, formato: 10,
};
const EN_MAYUSCULAS: ReadonlySet<ClaveCatalogo> = new Set(['arma', 'categoria', 'genero', 'formato']);

type Parametros = Record<string, string | string[] | undefined>;

export function leerCriteriosCatalogo(params: Parametros) {
  const primero = (valor: string | string[] | undefined, limite: number) =>
    ((Array.isArray(valor) ? valor[0] : valor) ?? '').trim().slice(0, limite + 1);
  const criterios = { ...CRITERIOS_CATALOGO_VACIOS };
  for (const clave of CLAVES_CATALOGO) {
    const valor = primero(params[clave], LIMITES[clave]);
    criterios[clave] = EN_MAYUSCULAS.has(clave) ? valor.toUpperCase() : valor;
  }
  return { criterios, cursor: primero(params.cursor, 600) || undefined };
}

/** Lo que entra en la consulta: sólo lo rellenado. */
export function entradaCatalogo(criterios: CriteriosCatalogo, cursor?: string): Record<string, string> {
  const entrada: Record<string, string> = {};
  for (const clave of CLAVES_CATALOGO) if (criterios[clave]) entrada[clave] = criterios[clave];
  if (cursor) entrada.cursor = cursor;
  return entrada;
}

export function hayFiltrosCatalogo(criterios: CriteriosCatalogo): boolean {
  return CLAVES_CATALOGO.some((clave) => clave !== 'q' && criterios[clave] !== '');
}

export function urlCatalogo(criterios: CriteriosCatalogo, cursor?: string): string {
  const params = new URLSearchParams();
  for (const clave of CLAVES_CATALOGO) {
    if (criterios[clave]) params.set(clave, criterios[clave]);
  }
  if (cursor) params.set('cursor', cursor);
  const texto = params.toString();
  return `${RUTA_EDICIONES}${texto ? `?${texto}` : ''}`;
}

const VALIDOS: Partial<Record<ClaveCatalogo, (v: string) => boolean>> = {
  fuente: (v) => FUENTES_CATALOGO.some((f) => f.valor === v),
  arma: (v) => ['FLORETE', 'ESPADA', 'SABLE'].includes(v),
  categoria: (v) => /^(M\d{1,2}|ABS|VET)$/.test(v),
  genero: (v) => (GENEROS_CATALOGO as readonly string[]).includes(v),
  formato: (v) => (FORMATOS_CATALOGO as readonly string[]).includes(v),
  desde: (v) => /^(19|20)\d{2}$/.test(v),
  hasta: (v) => /^(19|20)\d{2}$/.test(v),
  temporada: (v) => /^\d{4}(?:-\d{4})?$/.test(v),
};

/** Sólo el índice local y sus filtros conocidos, nunca un destino arbitrario. */
export function sanitizarRetornoCatalogo(crudo: string | undefined): string {
  if (!crudo || crudo.length > 4096 || /[\r\n\0#]/.test(crudo) ||
    (crudo !== RUTA_EDICIONES && !crudo.startsWith(`${RUTA_EDICIONES}?`))) return '';
  const params = new URLSearchParams(crudo.slice(RUTA_EDICIONES.length));
  const { criterios, cursor } = leerCriteriosCatalogo(Object.fromEntries(
    [...CLAVES_CATALOGO, 'cursor'].map((clave) => [clave, params.get(clave) ?? undefined]),
  ));
  if (criterios.q.length > 100 || (cursor && cursor.length > 600)) return '';
  for (const [clave, valido] of Object.entries(VALIDOS) as [ClaveCatalogo, (v: string) => boolean][]) {
    if (criterios[clave] && !valido(criterios[clave])) return '';
  }
  return urlCatalogo(criterios, cursor);
}
