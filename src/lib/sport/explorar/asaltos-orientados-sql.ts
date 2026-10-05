import { sql, type SQL } from 'drizzle-orm';
import { listaUuid } from './filtros-sql';

/**
 * Marcador máximo de un asalto individual. Por encima sólo hay relevos de
 * equipos publicados dentro de una prueba marcada como individual (45, 1512…):
 * se descartan en lugar de sumarlos como un asalto.
 */
export const MAX_TOCADOS_INDIVIDUAL = 15;

/**
 * Fecha de la edición como subconsulta escalar: `coalesce` no la evalúa si el
 * asalto o la prueba ya tienen fecha, y así no se lee la fila (ancha) de la
 * edición para cada asalto.
 */
export const FECHA_EDICION = '(SELECT e.start_date FROM sport_edition e WHERE e.id = c.edition_id)';

/**
 * CTEs `orientados` y `validos`: asaltos individuales de la persona (todos los
 * IDs del grupo fusionado), orientados hacia ella (`favor` son sus tocados).
 *
 * - Dos ramas para que cada una entre por su índice (`sport_bout_a_idx` /
 *   `sport_bout_b_idx`); la segunda descarta la fila que ya cogió la primera.
 * - CROSS JOIN fija el asalto como bucle exterior (D1 no tiene `sqlite_stat1`).
 * - MATERIALIZED evita que SQLite empuje la CTE dentro de la agregación y
 *   recorra los asaltos de cada prueba en vez de los de la persona.
 * - Dos fuentes con equivalencia explícita (mismo `event_competition_id`)
 *   cuentan una sola vez: se queda la prueba con el menor ID.
 */
export function sqlAsaltosOrientados(ids: readonly string[]): SQL {
  const columnas = (rival: string, favor: string, contra: string) => sql.raw(`
      b.id AS id, b.competition_id AS prueba, b.phase AS fase, b.${rival} AS rival_id,
      b.${favor} AS favor, b.${contra} AS contra,
      coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia,
      coalesce(b.occurred_on, c.competition_date, ${FECHA_EDICION}) AS fecha,
      coalesce(b.occurred_on, c.competition_date, ${FECHA_EDICION}, '0001-01-01') AS fecha_orden`);
  const uniones = sql.raw('CROSS JOIN sport_competition c ON c.id = b.competition_id');
  const individual = sql.raw(
    `c.format = 'INDIVIDUAL' AND max(b.score_a, b.score_b) <= ${MAX_TOCADOS_INDIVIDUAL}`,
  );
  return sql`
    orientados AS MATERIALIZED (
      SELECT ${columnas('fencer_b_person_id', 'score_a', 'score_b')}
      FROM sport_bout b ${uniones}
      WHERE b.fencer_a_person_id IN (${listaUuid(ids)}) AND ${individual}
      UNION ALL
      SELECT ${columnas('fencer_a_person_id', 'score_b', 'score_a')}
      FROM sport_bout b ${uniones}
      WHERE b.fencer_b_person_id IN (${listaUuid(ids)}) AND ${individual}
        AND (b.fencer_a_person_id IS NULL OR b.fencer_a_person_id NOT IN (${listaUuid(ids)}))
    ), elegidas AS (
      SELECT equivalencia, min(prueba) AS prueba FROM orientados GROUP BY equivalencia
    ), validos AS (
      SELECT o.* FROM orientados o JOIN elegidas el ON el.prueba = o.prueba
    )`;
}

export const MEDIDAS_REGISTRO = sql.raw(`
  count(*) AS asaltos,
  coalesce(sum(favor > contra), 0) AS victorias,
  coalesce(sum(favor < contra), 0) AS derrotas,
  coalesce(sum(favor = contra), 0) AS empates,
  coalesce(sum(favor), 0) AS dados,
  coalesce(sum(contra), 0) AS recibidos`);

export function porcentaje(victorias: number, derrotas: number): number | null {
  const decididos = victorias + derrotas;
  return decididos > 0 ? victorias / decididos : null;
}
