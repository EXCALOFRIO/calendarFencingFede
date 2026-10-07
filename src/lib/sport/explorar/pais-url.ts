import { RUTA_EXPLORAR } from './url';

/**
 * Direcciones y filtros de las fichas de país. El país va en la ruta
 * (`/explorar/pais/ESP`, el código de la FIE en mayúsculas) y los filtros en
 * la query. Sin importar nada de servidor: lo usan la página y los enlaces.
 *
 * Contrato con el buscador de Explorar: enlaza cada país a `rutaPais(codigo)`.
 */
export const RUTA_PAISES = `${RUTA_EXPLORAR}/pais`;

export const ARMAS_PAIS = ['ESPADA', 'FLORETE', 'SABLE'] as const;
export const GENEROS_PAIS = ['M', 'F'] as const;
/** Categorías que ofrece el filtro, en el orden en que se enseñan. */
export const CATEGORIAS_PAIS = ['ABS', 'M23', 'M20', 'M17', 'M15', 'M14', 'M13', 'VET'] as const;
export const MODALIDADES_PAIS = ['individual', 'equipos'] as const;

export type ModalidadPais = (typeof MODALIDADES_PAIS)[number];

export type FiltrosPais = {
  arma: string;
  genero: string;
  categoria: string;
  modalidad: '' | ModalidadPais;
};

export type FiltrosDuelo = FiltrosPais & {
  /** `2024-2025`; vacío = todas. */
  temporada: string;
};

export const FILTROS_PAIS_VACIOS: FiltrosPais = { arma: '', genero: '', categoria: '', modalidad: '' };
export const FILTROS_DUELO_VACIOS: FiltrosDuelo = { ...FILTROS_PAIS_VACIOS, temporada: '' };

type Parametros = Record<string, string | string[] | undefined>;

const primero = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? '').trim();

const de = <T extends string>(lista: readonly T[], valor: string): T | '' =>
  (lista as readonly string[]).includes(valor) ? (valor as T) : '';

const TEMPORADA_RE = /^(\d{4})-(\d{4})$/;

/** `2024-2025` con años seguidos; cualquier otra cosa se ignora. */
export function temporadaValida(valor: string): string {
  const m = TEMPORADA_RE.exec(valor);
  return m && Number(m[2]) === Number(m[1]) + 1 ? valor : '';
}

/**
 * Lee los filtros sin fallar: un valor desconocido se ignora (vale como «todos»),
 * así que nunca llega a una clave de caché nada que no esté en las listas.
 */
export function leerFiltrosPais(params: Parametros): FiltrosPais {
  return {
    arma: de(ARMAS_PAIS, primero(params.arma).toUpperCase()),
    genero: de(GENEROS_PAIS, primero(params.genero).toUpperCase()),
    categoria: de(CATEGORIAS_PAIS, primero(params.categoria).toUpperCase()),
    modalidad: de(MODALIDADES_PAIS, primero(params.modalidad).toLowerCase()),
  };
}

export function leerFiltrosDuelo(params: Parametros): FiltrosDuelo {
  return { ...leerFiltrosPais(params), temporada: temporadaValida(primero(params.temporada)) };
}

/** Cursor de la lista de pruebas: `fecha~idPrueba` de la última fila de la página anterior. */
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}|)~[0-9a-f-]{36}$/;

export function leerCursorDuelo(params: Parametros): string {
  const valor = primero(params.desde);
  return CURSOR_RE.test(valor) ? valor : '';
}

export function rutaPais(codigo: string): string {
  return `${RUTA_PAISES}/${codigo}`;
}

export function rutaDuelo(codigo: string, rival: string): string {
  return `${rutaPais(codigo)}/contra/${rival}`;
}

function consulta(f: Partial<FiltrosDuelo> & { desde?: string }): string {
  const p = new URLSearchParams();
  if (f.arma) p.set('arma', f.arma);
  if (f.genero) p.set('genero', f.genero);
  if (f.categoria) p.set('categoria', f.categoria);
  if (f.modalidad) p.set('modalidad', f.modalidad);
  if (f.temporada) p.set('temporada', f.temporada);
  if (f.desde) p.set('desde', f.desde);
  const texto = p.toString();
  return texto ? `?${texto}` : '';
}

export function urlPais(codigo: string, f: Partial<FiltrosPais> = {}): string {
  return `${rutaPais(codigo)}${consulta({ arma: f.arma, genero: f.genero, categoria: f.categoria, modalidad: f.modalidad })}`;
}

export function urlDuelo(codigo: string, rival: string, f: Partial<FiltrosDuelo> = {}, desde?: string): string {
  return `${rutaDuelo(codigo, rival)}${consulta({ ...f, desde })}`;
}

/** Modalidad de la URL → la de los agregados ('I', 'E', '' = las dos). */
export function modalidadAgregado(m: FiltrosPais['modalidad']): '' | 'I' | 'E' {
  return m === 'individual' ? 'I' : m === 'equipos' ? 'E' : '';
}

export const ETIQUETA_ARMA: Record<string, string> = { ESPADA: 'Espada', FLORETE: 'Florete', SABLE: 'Sable' };
export const ETIQUETA_GENERO: Record<string, string> = { M: 'Masculino', F: 'Femenino', MIXTO: 'Mixto' };
export const ETIQUETA_CATEGORIA: Record<string, string> = {
  ABS: 'Absoluto', M23: 'M23', M20: 'M20', M17: 'M17', M15: 'M15', M14: 'M14', M13: 'M13', VET: 'Veteranos',
};
export const ETIQUETA_MODALIDAD: Record<ModalidadPais, string> = { individual: 'Individual', equipos: 'Equipos' };
