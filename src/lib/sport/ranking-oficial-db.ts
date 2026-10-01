import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { FiltroRankingOficial, PublicacionRankingResumen } from './ranking-oficial';

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

type FilaCruda = {
  id: string;
  source: string;
  season: string;
  weapon: string;
  gender: string;
  category: string;
  categoryRaw: string;
  format: string;
  publishedOn: string;
  publishedTotal: number | null;
  sourceUrl: string | null;
  filas: FilaRankingOficial[] | string;
};

/**
 * SQL de la lectura: una sola sentencia, así que cabecera y filas salen del
 * mismo snapshot aunque otra escritura corrija la publicación a la vez. La
 * elección es la de `elegirPublicacion`: temporada exacta, modalidad
 * (individual por defecto) y la publicación más reciente.
 */
export function sqlRankingOficial(
  filtro: FiltroRankingOficial,
  limite: number,
  desde: number,
) {
  const formato = filtro.format ?? 'INDIVIDUAL';
  return sql`
    WITH elegida AS (
      SELECT id, source, season, weapon::text AS weapon, gender::text AS gender,
             category::text AS category, category_raw, format::text AS format,
             published_on::text AS published_on, published_total, source_url
      FROM sport_ranking_publication
      WHERE source = ${filtro.source}
        AND season = ${filtro.season}
        AND weapon::text = ${filtro.weapon}
        AND gender::text = ${filtro.gender}
        AND format::text = ${formato}
        ${filtro.category === undefined ? sql`` : sql`AND category::text = ${filtro.category}`}
        ${filtro.categoryRaw === undefined ? sql`` : sql`AND category_raw = ${filtro.categoryRaw}`}
        ${filtro.hasta === undefined ? sql`` : sql`AND published_on <= ${filtro.hasta}::date`}
      ORDER BY published_on DESC, fetched_at DESC, id DESC
      LIMIT 1
    )
    SELECT e.id, e.source, e.season, e.weapon, e.gender, e.category,
           e.category_raw AS "categoryRaw", e.format, e.published_on AS "publishedOn",
           e.published_total AS "publishedTotal", e.source_url AS "sourceUrl",
           (
             SELECT coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'sourceRef', f.source_ref,
                   'personId', f.person_id,
                   'sourceName', f.source_name,
                   'countryCode', f.country_code,
                   'position', f.position,
                   'points', f.points::text
                 ) ORDER BY f.position ASC NULLS LAST, f.source_ref ASC
               ),
               '[]'::jsonb
             )
             FROM (
               SELECT source_ref, person_id, source_name, country_code, position, points
               FROM sport_ranking_entry
               WHERE publication_id = e.id
               ORDER BY position ASC NULLS LAST, source_ref ASC
               LIMIT ${limite} OFFSET ${desde}
             ) f
           ) AS filas
    FROM elegida e`;
}

/**
 * Lista oficial de una temporada concreta, paginada. Sólo lectura sobre las
 * tablas `sport_ranking_*`; no toca el ranking interno.
 */
export async function leerRankingOficial(
  db: Pick<Db, 'execute'>,
  filtro: FiltroRankingOficial,
  pagina: { limite?: number; desde?: number } = {},
): Promise<SnapshotRankingOficial | null> {
  const limite = Math.max(0, Math.min(Math.trunc(pagina.limite ?? 100), 500));
  const desde = Math.max(0, Math.trunc(pagina.desde ?? 0));
  const resultado = await db.execute(sqlRankingOficial(filtro, limite, desde));
  const rows = (Array.isArray(resultado)
    ? resultado
    : (resultado as { rows?: unknown }).rows) as FilaCruda[] | undefined;
  const fila = rows?.[0];
  if (!fila) return null;

  const { filas, ...publicacion } = fila;
  return {
    publicacion,
    filas: typeof filas === 'string' ? (JSON.parse(filas) as FilaRankingOficial[]) : filas,
  };
}
