/**
 * Selección de la publicación de un ranking OFICIAL.
 *
 * La temporada es obligatoria y exacta: pedir una temporada que no tiene
 * publicación devuelve `null`, nunca la última publicada de otra. Dentro de la
 * temporada se toma la más reciente (o la última hasta un día dado) de la
 * fuente, arma, género, categoría y modalidad pedidos; individual y equipos no
 * se mezclan. No calcula ni rellena evolución entre publicaciones.
 */

export type PublicacionRankingResumen = {
  id: string;
  source: string;
  season: string;
  weapon: string;
  gender: string;
  category: string;
  categoryRaw: string;
  format: string;
  /** YYYY-MM-DD. */
  publishedOn: string;
};

export type FiltroRankingOficial = {
  source: string;
  season: string;
  weapon: string;
  gender: string;
  /** Código normalizado (`VET`) o, si se quiere un tramo concreto, `categoryRaw`. */
  category?: string;
  categoryRaw?: string;
  format?: 'INDIVIDUAL' | 'EQUIPOS';
  /** Última publicación hasta este día (inclusive). */
  hasta?: string;
};

export function elegirPublicacion(
  publicaciones: readonly PublicacionRankingResumen[],
  f: FiltroRankingOficial,
): PublicacionRankingResumen | null {
  const formato = f.format ?? 'INDIVIDUAL';
  const candidatas = publicaciones.filter(
    (p) =>
      p.source === f.source &&
      p.season === f.season &&
      p.weapon === f.weapon &&
      p.gender === f.gender &&
      p.format === formato &&
      (f.category === undefined || p.category === f.category) &&
      (f.categoryRaw === undefined || p.categoryRaw === f.categoryRaw) &&
      (f.hasta === undefined || p.publishedOn <= f.hasta),
  );
  if (candidatas.length === 0) return null;
  return candidatas.reduce((a, b) => (b.publishedOn > a.publishedOn ? b : a));
}
