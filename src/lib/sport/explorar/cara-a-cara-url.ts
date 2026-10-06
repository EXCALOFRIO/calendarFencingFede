import { UUID_RE } from './cursor';
import { RUTA_EXPLORAR, etiquetaTemporada, valorLegible } from './url';

/**
 * Criterios del cara a cara en la URL. La persona consultada va en la ruta
 * (`/explorar/{id}/cara-a-cara`) y todo lo demás en la query, de modo que
 * Atrás y los enlaces compartidos reproducen la misma consulta. Sin importar
 * nada de servidor: lo usan la página y el formulario cliente.
 */

export type CriteriosCaraACara = {
  /** Rival elegido; vacío = pantalla de elección de rival. */
  rival: string;
  /** Clave de temporada tal y como se guarda (FIE `AAAA`, RFEE `AAAA-AAAA`). */
  temporada: string;
  arma: string;
  fase: string;
  /** Búsqueda de rival por nombre; sólo tiene sentido sin rival elegido. */
  q: string;
  cursor: string;
};

export const CRITERIOS_CARA_A_CARA_VACIOS: CriteriosCaraACara = {
  rival: '',
  temporada: '',
  arma: '',
  fase: '',
  q: '',
  cursor: '',
};

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return ((Array.isArray(valor) ? valor[0] : valor) ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Lee `searchParams` sin validar vocabularios: un valor desconocido llega al
 * servidor y éste responde «entrada no válida», que la pantalla distingue de
 * «sin asaltos».
 */
export function leerCriteriosCaraACara(params: Parametros): CriteriosCaraACara {
  return {
    rival: primero(params.rival).slice(0, 40).toLowerCase(),
    temporada: primero(params.temporada).slice(0, 12),
    arma: primero(params.arma).slice(0, 12).toUpperCase(),
    fase: primero(params.fase).slice(0, 12).toUpperCase(),
    q: primero(params.q).slice(0, 80),
    cursor: primero(params.cursor).slice(0, 600),
  };
}

export function rutaCaraACara(personaId: string): string {
  return `${RUTA_EXPLORAR}/${personaId}/cara-a-cara`;
}

/**
 * URL de una vista del cara a cara. El cursor sólo viaja si se pide
 * expresamente: cambiar rival, temporada o cualquier filtro empieza siempre
 * en la primera página. Con rival elegido la búsqueda por nombre no aplica y
 * se descarta.
 */
export function construirUrlCaraACara(
  personaId: string,
  c: Partial<CriteriosCaraACara>,
  ancla?: string,
): string {
  const params = new URLSearchParams();
  if (c.rival) params.set('rival', c.rival);
  if (c.temporada) params.set('temporada', c.temporada);
  if (c.arma) params.set('arma', c.arma);
  if (c.fase) params.set('fase', c.fase);
  if (!c.rival && c.q) params.set('q', c.q);
  if (c.cursor) params.set('cursor', c.cursor);
  const texto = params.toString();
  return `${rutaCaraACara(personaId)}${texto ? `?${texto}` : ''}${ancla ? `#${ancla}` : ''}`;
}

/** Mismo cara a cara visto desde la otra persona: el marcador se invierte. */
export function urlVistaDelRival(
  personaId: string,
  rivalId: string,
  c: Partial<CriteriosCaraACara>,
): string {
  return construirUrlCaraACara(rivalId, { temporada: c.temporada, arma: c.arma, fase: c.fase, rival: personaId });
}

/**
 * El cara a cara con un rival, sin filtros: la elección de rival sólo busca
 * por nombre, así que una temporada, arma o fase que quedara en su dirección
 * (enlaces antiguos) no pasa al duelo.
 */
export function urlElegirRival(personaId: string, rivalId: string): string {
  return construirUrlCaraACara(personaId, { rival: rivalId });
}

export function rivalValido(rival: string): boolean {
  return UUID_RE.test(rival);
}

/** Entrada de `leerCaraACara`: sólo lo rellenado. */
export function aEntradaCaraACara(personaId: string, c: CriteriosCaraACara): Record<string, string> {
  const entrada: Record<string, string> = { personaId, rivalId: c.rival };
  if (c.temporada) entrada.temporada = c.temporada;
  if (c.arma) entrada.arma = c.arma;
  if (c.fase) entrada.fase = c.fase;
  if (c.cursor) entrada.cursor = c.cursor;
  return entrada;
}

/** Entrada de `listarRivales`: el nombre y la página; la temporada de un enlace antiguo se ignora. */
export function aEntradaRivales(personaId: string, c: CriteriosCaraACara): Record<string, string> {
  const entrada: Record<string, string> = { personaId };
  if (c.q) entrada.q = c.q;
  if (c.cursor) entrada.cursor = c.cursor;
  return entrada;
}

export const FASE_FILTRO: ReadonlyArray<{ valor: 'POULE' | 'TABLEAU'; etiqueta: string }> = [
  { valor: 'POULE', etiqueta: 'Poule' },
  { valor: 'TABLEAU', etiqueta: 'Eliminación directa' },
];

export type ChipCaraACara = {
  clave: 'temporada' | 'arma' | 'fase';
  etiqueta: string;
  valor: string;
  /** Misma consulta sin este criterio y desde la primera página. */
  quitar: string;
};

/** Filtros activos como enlaces que los quitan uno a uno, rival incluido. */
export function chipsCaraACara(personaId: string, c: CriteriosCaraACara): ChipCaraACara[] {
  const chips: ChipCaraACara[] = [];
  const sin = (clave: ChipCaraACara['clave']) =>
    construirUrlCaraACara(personaId, { ...c, cursor: '', [clave]: '' });
  if (c.temporada) {
    chips.push({ clave: 'temporada', etiqueta: 'Temporada', valor: etiquetaTemporada(c.temporada), quitar: sin('temporada') });
  }
  if (c.arma) {
    chips.push({ clave: 'arma', etiqueta: 'Arma', valor: valorLegible('arma', c.arma), quitar: sin('arma') });
  }
  if (c.fase) {
    const fase = FASE_FILTRO.find((f) => f.valor === c.fase);
    chips.push({ clave: 'fase', etiqueta: 'Fase', valor: fase?.etiqueta ?? c.fase, quitar: sin('fase') });
  }
  return chips;
}
