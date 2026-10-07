import type { RankingGroupKey } from '@/lib/queries/ranking';

/** Un grupo del ranking europeo con lista publicada: la última publicación con puestos. */
export type GrupoEuropeo = RankingGroupKey & {
  temporada: string;
  clasificados: number;
};

export type FilaEuropea = {
  puesto: number | null;
  nombre: string;
  /** ISO-3 publicado por la EFC; pinta la bandera. */
  pais: string | null;
  puntos: number | null;
  /** Persona de Explorar, si la fila está vinculada. */
  personaId: string | null;
};

export type TablaEuropea = {
  grupo: RankingGroupKey;
  temporada: string;
  publicadaEl: string | null;
  sourceUrl: string | null;
  filas: FilaEuropea[];
  espanoles: number;
};
