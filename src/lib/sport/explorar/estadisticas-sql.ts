import { sql } from 'drizzle-orm';
import {
  FECHA_RESULTADO, listaUuid, UNION_EVENTO_CANONICO, unionesPrueba,
} from './filtros-sql';
import { TIPO_ESTADISTICO_DOCUMENTADO } from './estadisticas-tipo';

export const LIMITE_CATEGORIAS_ESTADISTICAS = 120;
export const LIMITE_TEMPORADAS_ESTADISTICAS = 24;

const MEDIDAS = sql.raw(`
  count(*) AS pruebas,
  sum(CASE WHEN puesto > 0 THEN 1 ELSE 0 END) AS clasificaciones,
  min(puesto) AS "mejorPuesto",
  sum(CASE WHEN puesto BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS podios,
  sum(CASE WHEN puesto = 1 THEN 1 ELSE 0 END) AS victorias,
  sum(CASE WHEN puesto IS NULL THEN 1 ELSE 0 END) AS "sinPuesto",
  sum(conflicto) AS conflictos,
  sum(CASE WHEN fecha IS NULL THEN 1 ELSE 0 END) AS "sinFecha",
  min(fecha) AS desde, max(fecha) AS hasta`);

/**
 * Sólo agregados vuelven al Worker, nunca todo el historial.
 * Una equivalencia de prueba exige el MISMO event_competition_id, no nombres
 * ni fechas parecidos. Además conserva temporada, arma, género y categoría
 * literal. Las filas idénticas se deduplican; hechos discrepantes quedan como
 * conflicto sin puesto, sin dar prioridad arbitraria a la última fuente.
 */
export function consultaEstadisticas(ids: readonly string[]) {
  return sql`
    WITH hechos AS (
      SELECT coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia,
             c.season AS temporada, c.weapon AS arma, c.gender AS genero,
             c.category AS categoria, c.category_raw AS "categoriaRaw",
             ${TIPO_ESTADISTICO_DOCUMENTADO} AS tipo,
             CASE WHEN r.position > 0 THEN r.position END AS puesto,
             r.position_raw AS literal, r.official_points AS puntos,
             ${FECHA_RESULTADO} AS fecha
      FROM sport_result r
      ${unionesPrueba('r')}
      ${UNION_EVENTO_CANONICO}
      WHERE r.person_id IN (${listaUuid(ids)}) AND c.format = 'INDIVIDUAL'
    ), distintos AS (
      SELECT DISTINCT equivalencia, temporada, arma, genero, categoria, "categoriaRaw",
                      puesto, literal, puntos, fecha
      FROM hechos
    ), tipos_por_prueba AS (
      SELECT equivalencia, temporada, arma, genero, categoria, "categoriaRaw",
             CASE WHEN count(DISTINCT tipo) = 1 THEN min(tipo) END AS tipo
      FROM hechos
      GROUP BY equivalencia, temporada, arma, genero, categoria, "categoriaRaw"
    ), una_por_prueba AS (
      SELECT d.equivalencia, d.temporada, d.arma, d.genero, d.categoria, d."categoriaRaw",
             CASE WHEN count(*) = 1 THEN min(d.puesto) END AS puesto,
             CASE WHEN count(*) > 1 THEN 1 ELSE 0 END AS conflicto,
             CASE WHEN count(DISTINCT coalesce(d.fecha, '')) = 1 THEN min(d.fecha) END AS fecha,
             t.tipo
      FROM distintos d
      JOIN tipos_por_prueba t ON t.equivalencia = d.equivalencia
        AND t.temporada = d.temporada AND t.arma = d.arma AND t.genero = d.genero
        AND t.categoria = d.categoria AND t."categoriaRaw" IS d."categoriaRaw"
      GROUP BY d.equivalencia, d.temporada, d.arma, d.genero, d.categoria, d."categoriaRaw"
    ), categorias AS (
      SELECT 'categoria' AS clase, tipo, categoria, "categoriaRaw", arma, genero,
             NULL AS temporada, ${MEDIDAS}
      FROM una_por_prueba
      GROUP BY tipo, categoria, "categoriaRaw", arma, genero
      ORDER BY tipo IS NULL, tipo, categoria, "categoriaRaw", arma, genero
      LIMIT ${LIMITE_CATEGORIAS_ESTADISTICAS + 1}
    ), temporadas AS (
      SELECT 'temporada' AS clase, NULL AS tipo, NULL AS categoria, NULL AS "categoriaRaw",
             NULL AS arma, NULL AS genero, temporada, ${MEDIDAS}
      FROM una_por_prueba GROUP BY temporada ORDER BY temporada DESC
      LIMIT ${LIMITE_TEMPORADAS_ESTADISTICAS + 1}
    )
    SELECT 'total' AS clase, NULL AS tipo, NULL AS categoria, NULL AS "categoriaRaw",
           NULL AS arma, NULL AS genero, NULL AS temporada, ${MEDIDAS}
    FROM una_por_prueba
    UNION ALL
    SELECT 'tipo' AS clase, tipo, NULL AS categoria, NULL AS "categoriaRaw",
           NULL AS arma, NULL AS genero, NULL AS temporada, ${MEDIDAS}
    FROM una_por_prueba GROUP BY tipo
    UNION ALL SELECT * FROM categorias
    UNION ALL SELECT * FROM temporadas`;
}
