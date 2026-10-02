import { ARMAS, GENEROS, type Genero } from '@/lib/ambito';
import type { Weapon } from '@/lib/auth/session';

/**
 * Referencia local y acotada al estado del calendario, para volver a él desde
 * una edición, una persona o los favoritos sin perder lo que se estaba mirando.
 *
 * El calendario guarda su estado en el cliente; esta dirección es lo único que
 * viaja. Sin imports de servidor: la construye el cliente y la lee la página.
 * Todo valor es de la URL y no se fía: cada clave se valida por separado, lo
 * que no se entiende se descarta y la dirección se reconstruye siempre con las
 * claves conocidas. Nunca lleva un host ni una ruta distinta de la raíz.
 */

export const RUTA_CALENDARIO = '/';

export type Vista = 'mes' | 'trimestre';
export type Ambito = 'TODO' | 'NACIONAL' | 'INTERNACIONAL';

export type ContextoCalendario = {
  vista: Vista;
  /** Primer mes del periodo, `AAAA-MM`. */
  mes: string;
  ambito: Ambito;
  armas: Weapon[];
  generos: Genero[];
  categorias: string[];
  busqueda: string;
  /** Tirador con el que se mira, cuando la cuenta lleva varios. */
  tiradorId: string;
};

export type ContextoCalendarioLeido = Partial<ContextoCalendario>;

const LONGITUD_MAXIMA_BUSQUEDA = 60;
const MAXIMO_CATEGORIAS = 20;
/** Largo de la dirección ya codificada: lo que cabe en un retorno sin ser un vector de abuso. */
export const LONGITUD_MAXIMA_URL_CALENDARIO = 700;

const VISTAS: readonly Vista[] = ['mes', 'trimestre'];
const AMBITOS: readonly Ambito[] = ['TODO', 'NACIONAL', 'INTERNACIONAL'];
const MES_RE = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const CATEGORIA_RE = /^[A-Za-z0-9_]{1,12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** `undefined` si el parámetro falta o no queda ni un valor válido; `[]` si se escribió vacío a propósito. */
function lista<T extends string>(
  crudo: string | undefined,
  valido: (v: string) => T | null,
  maximo: number,
): T[] | undefined {
  if (crudo === undefined) return undefined;
  if (crudo === '') return [];
  const salida: T[] = [];
  for (const parte of crudo.split(',')) {
    const v = valido(parte.trim());
    if (v !== null && !salida.includes(v)) salida.push(v);
    if (salida.length >= maximo) break;
  }
  return salida.length > 0 ? salida : undefined;
}

function textoBusqueda(valor: string): string {
  return valor
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, LONGITUD_MAXIMA_BUSQUEDA);
}

export function leerContextoCalendario(params: Parametros): ContextoCalendarioLeido {
  const salida: ContextoCalendarioLeido = {};

  const vista = primero(params.vista);
  if (vista && (VISTAS as readonly string[]).includes(vista)) salida.vista = vista as Vista;

  const mes = primero(params.mes)?.trim();
  if (mes && MES_RE.test(mes)) salida.mes = mes;

  const ambito = primero(params.ambito);
  if (ambito && (AMBITOS as readonly string[]).includes(ambito)) salida.ambito = ambito as Ambito;

  const armas = lista(
    primero(params.armas),
    (v) => ((ARMAS as string[]).includes(v) ? (v as Weapon) : null),
    ARMAS.length,
  );
  if (armas) salida.armas = armas;

  const generos = lista(
    primero(params.generos),
    (v) => ((GENEROS as string[]).includes(v) ? (v as Genero) : null),
    GENEROS.length,
  );
  if (generos) salida.generos = generos;

  const categorias = lista(primero(params.categorias), (v) => (CATEGORIA_RE.test(v) ? v : null), MAXIMO_CATEGORIAS);
  if (categorias) salida.categorias = categorias;

  const busqueda = primero(params.q);
  if (busqueda !== undefined) {
    const limpia = textoBusqueda(busqueda);
    if (limpia) salida.busqueda = limpia;
  }

  const tirador = primero(params.tirador)?.trim();
  if (tirador && UUID_RE.test(tirador)) salida.tiradorId = tirador.toLowerCase();

  return salida;
}

function componer(c: ContextoCalendarioLeido, busqueda: string): string {
  const params = new URLSearchParams();
  if (c.vista && VISTAS.includes(c.vista)) params.set('vista', c.vista);
  if (c.mes && MES_RE.test(c.mes)) params.set('mes', c.mes);
  if (c.ambito && c.ambito !== 'TODO' && AMBITOS.includes(c.ambito)) params.set('ambito', c.ambito);
  const armas = c.armas ? [...new Set(c.armas.filter((a) => (ARMAS as string[]).includes(a)))] : undefined;
  if (armas) params.set('armas', armas.join(','));
  const generos = c.generos ? [...new Set(c.generos.filter((g) => (GENEROS as string[]).includes(g)))] : undefined;
  if (generos) params.set('generos', generos.join(','));
  if (c.categorias) {
    const validas = [...new Set(c.categorias.filter((x) => CATEGORIA_RE.test(x)))].slice(0, MAXIMO_CATEGORIAS);
    params.set('categorias', validas.join(','));
  }
  if (busqueda) params.set('q', busqueda);
  if (c.tiradorId && UUID_RE.test(c.tiradorId)) params.set('tirador', c.tiradorId.toLowerCase());
  const texto = params.toString();
  return texto ? `${RUTA_CALENDARIO}?${texto}` : RUTA_CALENDARIO;
}

/**
 * Dirección del calendario con el contexto indicado. Una lista vacía se escribe
 * (es un filtro puesto a propósito); lo no indicado no se escribe. Si la
 * búsqueda hace la dirección demasiado larga se recorta: es lo menos
 * importante de lo que se recuerda.
 */
export function construirUrlCalendario(c: ContextoCalendarioLeido): string {
  let busqueda = textoBusqueda(c.busqueda ?? '');
  let url = componer(c, busqueda);
  while (url.length > LONGITUD_MAXIMA_URL_CALENDARIO && busqueda) {
    busqueda = busqueda.slice(0, Math.floor(busqueda.length / 2));
    url = componer(c, busqueda);
  }
  return url.length > LONGITUD_MAXIMA_URL_CALENDARIO ? RUTA_CALENDARIO : url;
}

/**
 * Retorno al calendario recibido en la URL: sólo vale la raíz, con o sin
 * consulta. Cualquier otra ruta, un esquema, un host, un fragmento, una barra
 * invertida o un carácter de control dan `''`.
 */
export function sanitizarRetornoCalendario(crudo: string | undefined): string {
  const valor = crudo ?? '';
  if (!valor || valor.length > LONGITUD_MAXIMA_URL_CALENDARIO) return '';
  if (/[\u0000-\u001f\u007f\\#\s]/.test(valor)) return '';
  if (valor === RUTA_CALENDARIO) return RUTA_CALENDARIO;
  if (!valor.startsWith(`${RUTA_CALENDARIO}?`)) return '';
  const consulta = new URLSearchParams(valor.slice(RUTA_CALENDARIO.length + 1));
  const params: Parametros = {};
  for (const clave of ['vista', 'mes', 'ambito', 'armas', 'generos', 'categorias', 'q', 'tirador']) {
    const v = consulta.get(clave);
    if (v !== null) params[clave] = v;
  }
  return construirUrlCalendario(leerContextoCalendario(params));
}
