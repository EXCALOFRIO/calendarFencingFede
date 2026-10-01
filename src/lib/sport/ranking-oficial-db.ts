import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { sportRankingEntry, sportRankingPublication } from '@/db/schema';
import {
  elegirPublicacion,
  type FiltroRankingOficial,
  type PublicacionRankingResumen,
} from './ranking-oficial';

export type FilaRankingOficial = {
  sourceRef: string;
  personId: string | null;
  sourceName: string | null;
  countryCode: string | null;
  position: number | null;
  points: string | null;
};

export type SnapshotRankingOficial = {
  publicacion: PublicacionRankingResumen & { publishedTotal: number | null; sourceUrl: string | null };
  filas: FilaRankingOficial[];
};

/**
 * Lista oficial de una temporada concreta, paginada. Sólo lectura sobre las
 * tablas `sport_ranking_*`; no toca el ranking interno.
 */
export async function leerRankingOficial(
  db: Db,
  filtro: FiltroRankingOficial,
  pagina: { limite?: number; desde?: number } = {},
): Promise<SnapshotRankingOficial | null> {
  const candidatas = await db
    .select({
      id: sportRankingPublication.id,
      source: sportRankingPublication.source,
      season: sportRankingPublication.season,
      weapon: sportRankingPublication.weapon,
      gender: sportRankingPublication.gender,
      category: sportRankingPublication.category,
      categoryRaw: sportRankingPublication.categoryRaw,
      format: sportRankingPublication.format,
      publishedOn: sportRankingPublication.publishedOn,
      publishedTotal: sportRankingPublication.publishedTotal,
      sourceUrl: sportRankingPublication.sourceUrl,
    })
    .from(sportRankingPublication)
    .where(
      and(
        eq(sportRankingPublication.source, filtro.source),
        eq(sportRankingPublication.season, filtro.season),
        eq(sportRankingPublication.weapon, filtro.weapon as 'FLORETE' | 'ESPADA' | 'SABLE'),
        eq(sportRankingPublication.gender, filtro.gender as 'M' | 'F' | 'MIXTO'),
      ),
    );

  const elegida = elegirPublicacion(candidatas, filtro);
  if (!elegida) return null;
  const publicacion = candidatas.find((c) => c.id === elegida.id)!;

  const filas = await db
    .select({
      sourceRef: sportRankingEntry.sourceRef,
      personId: sportRankingEntry.personId,
      sourceName: sportRankingEntry.sourceName,
      countryCode: sportRankingEntry.countryCode,
      position: sportRankingEntry.position,
      points: sportRankingEntry.points,
    })
    .from(sportRankingEntry)
    .where(eq(sportRankingEntry.publicationId, publicacion.id))
    .orderBy(asc(sportRankingEntry.position), asc(sportRankingEntry.sourceRef))
    .limit(Math.min(pagina.limite ?? 100, 500))
    .offset(pagina.desde ?? 0);

  return { publicacion, filas };
}
