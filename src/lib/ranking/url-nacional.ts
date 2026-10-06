/**
 * Enlaces a la clasificación nacional de una temporada concreta:
 * `/ranking?temporada=2021-2022&arma=ESPADA&genero=F&categoria=M20`.
 *
 * `categoria` es el literal publicado por la RFEE («M20», «VET40»), no el
 * código agrupado: los veteranos tienen una lista por tramo.
 */

export const RUTA_RANKING = '/ranking';

export type ArmaNacional = 'ESPADA' | 'FLORETE' | 'SABLE';
export type GeneroNacional = 'M' | 'F';

export type FiltroRankingNacional = {
  temporada: string | null;
  arma: ArmaNacional | null;
  genero: GeneroNacional | null;
  categoria: string | null;
};

const ARMAS: readonly string[] = ['ESPADA', 'FLORETE', 'SABLE'];
const TEMPORADA = /^(\d{4})-(\d{4})$/;
const CATEGORIA = /^[A-Z0-9]{1,8}$/;

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function esTemporadaRfee(v: string): boolean {
  const m = TEMPORADA.exec(v);
  return m !== null && Number(m[2]) === Number(m[1]) + 1;
}

export function leerFiltroRankingNacional(
  params: Record<string, string | string[] | undefined>,
): FiltroRankingNacional {
  const temporada = uno(params.temporada).trim();
  const arma = uno(params.arma).trim().toUpperCase();
  const genero = uno(params.genero).trim().toUpperCase();
  const categoria = uno(params.categoria).trim().toUpperCase();
  return {
    temporada: esTemporadaRfee(temporada) ? temporada : null,
    arma: ARMAS.includes(arma) ? (arma as ArmaNacional) : null,
    genero: genero === 'M' || genero === 'F' ? genero : null,
    categoria: CATEGORIA.test(categoria) ? categoria : null,
  };
}

export function rutaRankingNacional(f: Partial<FiltroRankingNacional>): string {
  const p = new URLSearchParams();
  if (f.temporada) p.set('temporada', f.temporada);
  if (f.arma) p.set('arma', f.arma);
  if (f.genero) p.set('genero', f.genero);
  if (f.categoria) p.set('categoria', f.categoria);
  const q = p.toString();
  return q ? `${RUTA_RANKING}?${q}` : RUTA_RANKING;
}

/** «2021-2022» → «21-22». */
export function temporadaCorta(t: string): string {
  const m = TEMPORADA.exec(t);
  return m ? `${m[1].slice(2)}-${m[2].slice(2)}` : t;
}
