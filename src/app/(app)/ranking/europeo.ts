import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { FilaEuropea, GrupoEuropeo, TablaEuropea } from '@/components/ranking/tipos-europeo';
import type { RankingGroupKey } from '@/lib/queries/ranking';
import { FUENTES_CONTINENTALES } from '@/lib/sport/rankings-internacionales-fuentes';

/**
 * El ranking europeo (EFC) para /ranking, leído de `sport_ranking_publication`
 * y `sport_ranking_entry`, que es donde lo guarda la ingesta de rankings
 * internacionales. Por grupo vale la última publicación con algún puesto.
 *
 * Sólo entran las dos temporadas más recientes: al empezar una temporada la
 * EFC publica la cadete antes que la sub-23, y quedarse sólo con la nueva
 * dejaría la sub-23 sin lista; una lista de hace tres años ya no es «el
 * ranking europeo».
 */

type Ejecutor = Pick<Db, 'execute'>;

function filasDe<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const rows = (r as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

const FUENTES = JSON.stringify(FUENTES_CONTINENTALES);

/*
  Se cuentan los puestos sólo de la publicación ganadora de cada grupo: contar
  los de todas las publicaciones continentales leía ~54.000 filas.
*/
export const SQL_GRUPOS_EUROPEOS = sql`
  WITH fuentes AS (SELECT value FROM json_each(${FUENTES})),
  temporadas AS (
    SELECT DISTINCT season FROM sport_ranking_publication
    WHERE source IN (SELECT value FROM fuentes) AND format = 'INDIVIDUAL'
    ORDER BY season DESC LIMIT 2
  ),
  ultima AS (
    SELECT p.id, p.season, p.weapon, p.gender, p.category, row_number() OVER (
      PARTITION BY p.weapon, p.gender, p.category
      ORDER BY p.season DESC, p.published_on DESC, p.fetched_at DESC, p.id DESC) AS orden
    FROM sport_ranking_publication p
    WHERE p.source IN (SELECT value FROM fuentes) AND p.format = 'INDIVIDUAL'
      AND p.season IN (SELECT season FROM temporadas)
      AND EXISTS (SELECT 1 FROM sport_ranking_entry e WHERE e.publication_id = p.id AND e.position IS NOT NULL)
  )
  SELECT u.id, u.season AS temporada, u.weapon, u.gender, u.category,
         (SELECT count(*) FROM sport_ranking_entry e WHERE e.publication_id = u.id AND e.position IS NOT NULL) AS clasificados
  FROM ultima u WHERE u.orden = 1
  ORDER BY CASE u.weapon WHEN 'ESPADA' THEN 0 WHEN 'FLORETE' THEN 1 ELSE 2 END,
           CASE u.gender WHEN 'M' THEN 0 ELSE 1 END, u.category`;

/** Los grupos, con la publicación que vale de cada uno (no sale al navegador). */
export type GrupoEuropeoLeido = GrupoEuropeo & { publicacion: string };

export async function leerGruposEuropeos(db: Ejecutor): Promise<GrupoEuropeoLeido[]> {
  if (FUENTES_CONTINENTALES.length === 0) return [];
  return filasDe<{ id: string; temporada: string; weapon: string; gender: string; category: string; clasificados: number }>(
    await db.execute(SQL_GRUPOS_EUROPEOS),
  ).map((f) => ({
    publicacion: f.id,
    temporada: f.temporada,
    weapon: f.weapon as RankingGroupKey['weapon'],
    gender: f.gender as RankingGroupKey['gender'],
    category: f.category as RankingGroupKey['category'],
    clasificados: Number(f.clasificados),
  }));
}

export function sqlTablaEuropea(publicacion: string) {
  return sql`
    SELECT e.position AS puesto, e.source_name AS nombre, e.country_code AS pais, e.points AS puntos,
           coalesce(per.merged_into_person_id, e.person_id) AS "personaId",
           p.season AS temporada, p.published_on AS "publicadaEl", p.source_url AS "sourceUrl"
    FROM sport_ranking_publication p
    JOIN sport_ranking_entry e ON e.publication_id = p.id
    LEFT JOIN sport_person per ON per.id = e.person_id
    WHERE p.id = ${publicacion} AND e.position IS NOT NULL
    ORDER BY e.position ASC, e.source_name ASC`;
}

export async function leerTablaEuropea(db: Ejecutor, grupo: GrupoEuropeoLeido): Promise<TablaEuropea | null> {
  const filas = filasDe<{
    puesto: number | null; nombre: string | null; pais: string | null; puntos: number | string | null;
    personaId: string | null; temporada: string; publicadaEl: string | null; sourceUrl: string | null;
  }>(await db.execute(sqlTablaEuropea(grupo.publicacion)));
  if (filas.length === 0) return null;
  const salida: FilaEuropea[] = filas.map((f) => {
    const puntos = f.puntos === null ? null : Number(f.puntos);
    return {
      puesto: f.puesto === null ? null : Number(f.puesto),
      nombre: f.nombre ?? '',
      pais: f.pais?.trim().toUpperCase() || null,
      puntos: puntos !== null && Number.isFinite(puntos) ? puntos : null,
      personaId: f.personaId,
    };
  });
  return {
    grupo: { weapon: grupo.weapon, gender: grupo.gender, category: grupo.category },
    temporada: filas[0].temporada,
    publicadaEl: filas[0].publicadaEl,
    sourceUrl: filas[0].sourceUrl,
    filas: salida,
    espanoles: salida.filter((f) => f.pais === 'ESP').length,
  };
}
