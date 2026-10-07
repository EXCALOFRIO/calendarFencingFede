/**
 * Clasificaciones publicadas por organismos distintos de la RFEE que se guardan
 * en `sport_ranking_publication` / `sport_ranking_entry` con su propio `source`.
 *
 * `fie_tiradores` es la lectura diaria de la temporada en curso (ingesta FIE);
 * `fie_historico` son las temporadas anteriores, cargadas aparte. Las dos son
 * el ranking mundial y se leen juntas.
 */

export type AmbitoRanking = 'mundial' | 'continental' | 'nacional';

export type FuenteRankingInternacional =
  | 'fie_historico'
  | 'efc_ranking'
  | 'ffe_classement'
  | 'fis_ranking'
  | 'hkfa_ranking'
  | 'mvsz_ranglista'
  | 'bf_ranking'
  | 'cff_ranking';

export type DescripcionFuente = {
  ambito: AmbitoRanking;
  /** Siglas del organismo que publica la lista. */
  organismo: string;
  nombre: string;
  /** País (COI) de la federación nacional; `null` en mundial y continental. */
  pais: string | null;
  /** Confederación continental; `null` en mundial y nacional. */
  continente: 'europa' | 'africa' | 'asia' | 'america' | null;
  /** Página pública a la que se enlaza siempre. */
  web: string;
};

export const FUENTES_RANKING: Record<FuenteRankingInternacional | 'fie_tiradores' | 'skermo_ranking', DescripcionFuente> = {
  fie_tiradores: { ambito: 'mundial', organismo: 'FIE', nombre: 'Ranking mundial FIE', pais: null, continente: null, web: 'https://fie.org/athletes' },
  fie_historico: { ambito: 'mundial', organismo: 'FIE', nombre: 'Ranking mundial FIE', pais: null, continente: null, web: 'https://fie.org/athletes' },
  efc_ranking: { ambito: 'continental', organismo: 'EFC', nombre: 'Ranking europeo EFC', pais: null, continente: 'europa', web: 'https://www.fencing-efc.eu/rankings' },
  skermo_ranking: { ambito: 'nacional', organismo: 'RFEE', nombre: 'Ranking nacional RFEE', pais: 'ESP', continente: null, web: 'https://app.skermo.org/ranking-rfee/public/RFEE' },
  ffe_classement: { ambito: 'nacional', organismo: 'FFE', nombre: 'Classement national FFE', pais: 'FRA', continente: null, web: 'https://www.ffescrime.fr/classements/' },
  fis_ranking: { ambito: 'nacional', organismo: 'FIS', nombre: 'Ranking nazionale FIS', pais: 'ITA', continente: null, web: 'https://federscherma.it/' },
  hkfa_ranking: { ambito: 'nacional', organismo: 'FAHK', nombre: 'Ranking de Hong Kong', pais: 'HKG', continente: null, web: 'https://www.hkfa.org.hk/EN/ranking.html' },
  mvsz_ranglista: { ambito: 'nacional', organismo: 'MVSZ', nombre: 'Ranglista MVSZ (Hungría)', pais: 'HUN', continente: null, web: 'https://versenyinfo.hunfencing.hu/index.php?p=pRanglista' },
  bf_ranking: { ambito: 'nacional', organismo: 'BF', nombre: 'British Fencing rankings (Gran Bretaña)', pais: 'GBR', continente: null, web: 'https://www.britishfencing.com/rankings/' },
  cff_ranking: { ambito: 'nacional', organismo: 'CFF', nombre: 'Canadian Fencing Federation rankings (Canadá)', pais: 'CAN', continente: null, web: 'https://fencing.ca/rankings-and-classifications/' },
};

export const FUENTES_MUNDIALES = ['fie_tiradores', 'fie_historico'] as const;

export function fuentesNacionalesDe(pais: string | null): string[] {
  if (!pais) return [];
  return Object.entries(FUENTES_RANKING).filter(([, d]) => d.ambito === 'nacional' && d.pais === pais).map(([k]) => k);
}

export const FUENTES_CONTINENTALES = Object.entries(FUENTES_RANKING)
  .filter(([, d]) => d.ambito === 'continental')
  .map(([k]) => k);
