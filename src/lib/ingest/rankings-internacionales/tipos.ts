import type { FuenteRankingInternacional } from '@/lib/sport/rankings-internacionales-fuentes';

export type Arma = 'FLORETE' | 'ESPADA' | 'SABLE';
export type Genero = 'M' | 'F';
export type Categoria = 'M14' | 'M15' | 'M17' | 'M20' | 'M23' | 'ABS' | 'VET';

/** Una fila tal como la publica la fuente, ya normalizada a nuestro vocabulario. */
export type FilaInternacional = {
  /** Referencia estable dentro de la fuente (`fie:123`, `efc:867640`, `ffe:53090`...). */
  ref: string;
  /** Nombre visible tal cual («SAVIN Rafael»). */
  nombre: string;
  /** Código de país COI (alfa-3) si la fuente lo publica o se deduce sin ambigüedad. */
  pais: string | null;
  puesto: number | null;
  puntos: string | null;
  /** Id FIE (`addrId`) cuando la fuente lo publica: vínculo directo. */
  fieId?: number | null;
  anioNacimiento?: number | null;
};

/** Una lista de clasificación: una fuente, temporada, arma, género y categoría. */
export type ListaInternacional = {
  fuente: FuenteRankingInternacional;
  /** Temporada con el formato de la fuente en la tabla (`2024` FIE, `2024-2025` resto). */
  temporada: string;
  arma: Arma;
  genero: Genero;
  categoria: Categoria;
  /** Categoría tal como la nombra la fuente (va a `category_raw`). */
  categoriaRaw: string;
  /** Día de referencia de la lista (YYYY-MM-DD): el publicado si lo hay, si no el de lectura. */
  publicadoEl: string;
  /** `source` si la fecha la publica la fuente; `observed` si es el día de lectura. */
  baseFecha: 'source' | 'observed';
  url: string;
  /** Filas publicadas en la lista (antes de filtrar por vínculo). */
  total: number;
  filas: FilaInternacional[];
};
