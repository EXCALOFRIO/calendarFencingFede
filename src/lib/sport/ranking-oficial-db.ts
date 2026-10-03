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
      SELECT id, source, season, weapon AS weapon, gender AS gender,
             category AS category, category_raw, format AS format,
             published_on AS published_on, published_total, source_url
      FROM sport_ranking_publication
      WHERE source = ${filtro.source}
        AND season = ${filtro.season}
        AND weapon = ${filtro.weapon}
        AND gender = ${filtro.gender}
        AND format = ${formato}
        ${filtro.category === undefined ? sql`` : sql`AND category = ${filtro.category}`}
        ${filtro.categoryRaw === undefined ? sql`` : sql`AND category_raw = ${filtro.categoryRaw}`}
        ${filtro.hasta === undefined ? sql`` : sql`AND published_on <= ${filtro.hasta}`}
      ORDER BY published_on DESC, fetched_at DESC, id DESC
      LIMIT 1
    )
    SELECT e.id, e.source, e.season, e.weapon, e.gender, e.category,
           e.category_raw AS "categoryRaw", e.format, e.published_on AS "publishedOn",
           e.published_total AS "publishedTotal", e.source_url AS "sourceUrl",
           (
             SELECT coalesce(
               json_group_array(
                 json_object(
                   'sourceRef', f.source_ref,
                   'personId', f.person_id,
                   'sourceName', f.source_name,
                   'countryCode', f.country_code,
                   'position', f.position,
                   'points', f.points
                 )
               ),
               '[]'
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

export type EntradaPersonaRankingOficial = {
  publicacion: PublicacionRankingResumen & {
    publishedTotal: number | null;
    sourceUrl: string | null;
  };
  sourceRef: string;
  position: number | null;
  points: string | null;
};

/**
 * Puesto de unas personas en cada lista oficial de UNA temporada y modalidad.
 *
 * Para cada `(fuente, arma, género, categoría de la fuente)` se toma la misma
 * publicación que `sqlRankingOficial` (la más reciente de esa temporada exacta)
 * y sólo después se busca a la persona en ella: si no figura en la última
 * publicación no se le atribuye la de una anterior. Es una única sentencia, así
 * que cabecera y fila salen del mismo snapshot. Temporada y modalidad son
 * obligatorias: no hay «la última» ni mezcla de individual y equipos.
 */
export function sqlRankingOficialDePersonas(
  personIds: readonly string[],
  season: string,
  format: 'INDIVIDUAL' | 'EQUIPOS',
) {
  const ids = sql`SELECT value FROM json_each(${JSON.stringify(personIds)})`;
  return sql`
    WITH ordenadas AS (
      SELECT p.id, p.source, p.season, p.weapon AS weapon, p.gender AS gender,
             p.category AS category, p.category_raw, p.format AS format,
             p.published_on AS published_on, p.published_total, p.source_url,
             row_number() OVER (
               PARTITION BY p.source, p.weapon, p.gender, p.category_raw, p.format
               ORDER BY p.published_on DESC, p.fetched_at DESC, p.id DESC
             ) AS orden
      FROM sport_ranking_publication p
      WHERE p.season = ${season} AND p.format = ${format}
    ), elegidas AS (
      SELECT * FROM ordenadas WHERE orden = 1
    )
    SELECT g.id, g.source, g.season, g.weapon, g.gender, g.category,
           g.category_raw AS "categoryRaw", g.format, g.published_on AS "publishedOn",
           g.published_total AS "publishedTotal", g.source_url AS "sourceUrl",
           e.source_ref AS "sourceRef", e.position, e.points AS points
    FROM elegidas g
    JOIN sport_ranking_entry e ON e.publication_id = g.id
    WHERE e.person_id IN (${ids})
    ORDER BY g.weapon, g.gender, g.category_raw, g.source, e.source_ref`;
}

export async function leerRankingOficialDePersonas(
  db: Pick<Db, 'execute'>,
  personIds: readonly string[],
  season: string,
  format: 'INDIVIDUAL' | 'EQUIPOS',
): Promise<EntradaPersonaRankingOficial[]> {
  if (personIds.length === 0) return [];
  const resultado = await db.execute(sqlRankingOficialDePersonas(personIds, season, format));
  const rows = (Array.isArray(resultado)
    ? resultado
    : (resultado as { rows?: unknown }).rows) as
    | (PublicacionRankingResumen & {
        publishedTotal: number | null;
        sourceUrl: string | null;
        sourceRef: string;
        position: number | null;
        points: string | null;
      })[]
    | undefined;
  return (rows ?? []).map(({ sourceRef, position, points, ...publicacion }) => ({
    publicacion,
    sourceRef,
    position: position === null ? null : Number(position),
    points,
  }));
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
