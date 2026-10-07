import { sql, type SQL } from 'drizzle-orm';
import { SALTOS } from './personas';
import { FECHA_ORDEN_RESULTADO, FECHA_RESULTADO, listaUuid } from './filtros-sql';

const UNIONES_ASALTO = sql.raw(`JOIN sport_competition c ON c.id = b.competition_id
      JOIN sport_edition e ON e.id = c.edition_id`);

export const LIMITE_TEMPORADAS_ASALTOS = 30;
export const LIMITE_RIVALES_FRECUENTES = 8;
export const LIMITE_CLUBES_RECIENTES = 12;

/**
 * Temporada deportiva común. La FIE etiqueta con el año final (`2025` es
 * septiembre de 2024 a agosto de 2025) y la RFEE con los dos años, así que se
 * llevan las dos al formato `AAAA-AAAA` para poder contarlas juntas.
 */
const TEMPORADA_DEPORTIVA = `(CASE
  WHEN c.season GLOB '[0-9][0-9][0-9][0-9]' THEN (CAST(c.season AS INTEGER) - 1) || '-' || c.season
  ELSE c.season END)`;

/**
 * Asaltos individuales de la persona, orientados hacia ella. Dos ramas para que
 * cada una use su índice (`sport_bout_a_idx` / `sport_bout_b_idx`); la segunda
 * excluye la fila que ya recogió la primera. Si dos fuentes publican la misma
 * prueba con equivalencia explícita (mismo `event_competition_id`), sólo
 * cuentan los asaltos de una de ellas: nunca se suman dos copias del mismo
 * asalto ni se mezclan marcadores de fuentes distintas.
 */
export function asaltosValidos(
  ids: readonly string[],
  /**
   * `ligero`: sin torneo ni fechas, así que no se une la edición; y `validos`
   * se materializa porque el balance la lee varias veces (sin ello cada lectura
   * repite el cruce con `elegidas` y su índice automático).
   */
  { ligero = false }: { ligero?: boolean } = {},
): SQL {
  const columnas = (rival: string, favor: string, contra: string) => sql.raw(`
      b.id AS id, b.competition_id AS prueba, b.phase AS fase, b.${rival} AS rival_id,
      b.${favor} AS favor, b.${contra} AS contra,
      coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia,
      ${TEMPORADA_DEPORTIVA} AS temporada${ligero ? '' : `,
      e.name AS torneo,
      coalesce(b.occurred_on, c.competition_date, e.start_date) AS fecha,
      coalesce(b.occurred_on, c.competition_date, e.start_date, '0001-01-01') AS fecha_orden`}`);
  const uniones = ligero ? sql.raw('JOIN sport_competition c ON c.id = b.competition_id') : UNIONES_ASALTO;
  // MATERIALIZED: si SQLite la inserta en `validos`, entra por la prueba y
  // recorre todos los asaltos de cada una (sport_bout_key) en vez de los de la persona.
  return sql`
    orientados AS MATERIALIZED (
      SELECT ${columnas('fencer_b_person_id', 'score_a', 'score_b')}
      FROM sport_bout b ${uniones}
      WHERE b.fencer_a_person_id IN (${listaUuid(ids)}) AND c.format = 'INDIVIDUAL'
      UNION ALL
      SELECT ${columnas('fencer_a_person_id', 'score_b', 'score_a')}
      FROM sport_bout b ${uniones}
      WHERE b.fencer_b_person_id IN (${listaUuid(ids)}) AND c.format = 'INDIVIDUAL'
        AND (b.fencer_a_person_id IS NULL OR b.fencer_a_person_id NOT IN (${listaUuid(ids)}))
    ), elegidas AS (
      SELECT equivalencia, min(prueba) AS prueba FROM orientados GROUP BY equivalencia
    ), validos AS ${sql.raw(ligero ? 'MATERIALIZED ' : '')}(
      SELECT o.* FROM orientados o JOIN elegidas el ON el.prueba = o.prueba
    )`;
}

const MEDIDAS_ASALTOS = sql.raw(`
  count(*) AS asaltos,
  coalesce(sum(CASE WHEN favor > contra THEN 1 ELSE 0 END), 0) AS victorias,
  coalesce(sum(CASE WHEN favor < contra THEN 1 ELSE 0 END), 0) AS derrotas,
  coalesce(sum(CASE WHEN favor = contra THEN 1 ELSE 0 END), 0) AS empates,
  coalesce(sum(favor), 0) AS "tocadosDados",
  coalesce(sum(contra), 0) AS "tocadosRecibidos"`);

const SUMAS_ASALTOS = sql.raw(`
  coalesce(sum(asaltos), 0) AS asaltos,
  coalesce(sum(victorias), 0) AS victorias,
  coalesce(sum(derrotas), 0) AS derrotas,
  coalesce(sum(empates), 0) AS empates,
  coalesce(sum("tocadosDados"), 0) AS "tocadosDados",
  coalesce(sum("tocadosRecibidos"), 0) AS "tocadosRecibidos"`);

export type FilaBalanceAsaltos = {
  clase: 'total' | 'fase' | 'temporada';
  fase: 'POULE' | 'TABLEAU' | null;
  temporada: string | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
  empates: number;
  tocadosDados: number;
  tocadosRecibidos: number;
  /** Sólo en la fila total: rivales distintos, ya llevados a su persona canónica. */
  rivales?: number | null;
};

/**
 * Balance total, por fase y por temporada en una sola sentencia; sólo agregados vuelven al Worker.
 * La fila total cuenta además los rivales distintos: cada rival se lleva a la
 * persona que prevalece (un salto, las fusiones no encadenan) para que dos
 * fichas fundidas del mismo rival cuenten una vez.
 *
 * Los asaltos se recorren una vez, agrupados por fase y temporada (`grupos`,
 * unas decenas de filas); total, fases y temporadas suman esos grupos.
 */
export function sqlBalanceAsaltos(ids: readonly string[]) {
  return sql`
    WITH ${asaltosValidos(ids, { ligero: true })}, grupos AS MATERIALIZED (
      SELECT fase, temporada, ${MEDIDAS_ASALTOS} FROM validos GROUP BY fase, temporada
    ), por_temporada AS (
      SELECT 'temporada' AS clase, NULL AS fase, temporada, ${SUMAS_ASALTOS}, NULL AS rivales
      FROM grupos GROUP BY temporada ORDER BY temporada DESC
      LIMIT ${LIMITE_TEMPORADAS_ASALTOS}
    ), rivales_distintos AS (
      SELECT count(DISTINCT coalesce(p.merged_into_person_id, p.id)) AS n
      FROM (SELECT DISTINCT rival_id FROM validos WHERE rival_id IS NOT NULL) d
      CROSS JOIN sport_person p ON p.id = d.rival_id
      WHERE coalesce(p.merged_into_person_id, p.id) NOT IN (${listaUuid(ids)})
    )
    SELECT 'total' AS clase, NULL AS fase, NULL AS temporada, ${SUMAS_ASALTOS},
           (SELECT n FROM rivales_distintos) AS rivales
    FROM grupos
    UNION ALL
    SELECT 'fase' AS clase, fase, NULL AS temporada, ${SUMAS_ASALTOS}, NULL AS rivales FROM grupos GROUP BY fase
    UNION ALL
    SELECT * FROM por_temporada`;
}

export type FilaRivalFrecuente = {
  id: string;
  nombreRival: string;
  paisRival: string | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
  ultimaFecha: string | null;
  ultimoFavor: number;
  ultimoContra: number;
  ultimoTorneo: string;
};

/**
 * Rivales con más asaltos individuales contra la persona. El rival se lleva a
 * su persona canónica siguiendo las fusiones (misma profundidad que
 * `resolverPersona`), así que dos fichas fundidas del mismo rival suman en una.
 * Un asalto sin rival resuelto no cuenta: no se adivina por nombre.
 */
export function sqlRivalesFrecuentes(ids: readonly string[], canonicaId: string) {
  return sql`
    WITH RECURSIVE ${asaltosValidos(ids)}, ruta(rival_id, id, destino, salto) AS (
      SELECT DISTINCT v.rival_id, p.id, p.merged_into_person_id, 0
      FROM validos v JOIN sport_person p ON p.id = v.rival_id
      UNION ALL
      SELECT r.rival_id, p.id, p.merged_into_person_id, r.salto + 1
      FROM ruta r JOIN sport_person p ON p.id = r.destino WHERE r.salto < ${SALTOS}
    ), con_rival AS (
      SELECT v.favor, v.contra, v.fecha, v.fecha_orden, v.torneo, r.id AS canon,
             row_number() OVER (PARTITION BY r.id ORDER BY v.fecha_orden DESC, v.id DESC) AS orden
      FROM validos v JOIN ruta r ON r.rival_id = v.rival_id AND r.destino IS NULL
      WHERE r.id <> ${canonicaId}
    ), agregado AS (
      SELECT canon, count(*) AS asaltos,
             sum(CASE WHEN favor > contra THEN 1 ELSE 0 END) AS victorias,
             sum(CASE WHEN favor < contra THEN 1 ELSE 0 END) AS derrotas,
             max(CASE WHEN orden = 1 THEN fecha END) AS "ultimaFecha",
             max(CASE WHEN orden = 1 THEN fecha_orden END) AS "ultimaOrden",
             max(CASE WHEN orden = 1 THEN favor END) AS "ultimoFavor",
             max(CASE WHEN orden = 1 THEN contra END) AS "ultimoContra",
             max(CASE WHEN orden = 1 THEN torneo END) AS "ultimoTorneo"
      FROM con_rival GROUP BY canon
    )
    SELECT cp.id AS id, cp.display_name AS "nombreRival", cp.country_code AS "paisRival",
           a.asaltos, a.victorias, a.derrotas, a."ultimaFecha", a."ultimoFavor",
           a."ultimoContra", a."ultimoTorneo"
    FROM agregado a JOIN sport_person cp ON cp.id = a.canon
    ORDER BY a.asaltos DESC, a."ultimaOrden" DESC, cp.id
    LIMIT ${LIMITE_RIVALES_FRECUENTES}`;
}

export type FilaClubPublicado = { club: string; fuente: string; fecha: string | null };

/** Clubes publicados en los resultados más recientes (por `sport_result_person_date_idx`). */
export function sqlClubesRecientes(ids: readonly string[]) {
  return sql`
    SELECT r.source_club AS club, r.source AS fuente, (${FECHA_RESULTADO}) AS fecha
    FROM sport_result r
    JOIN sport_competition c ON c.id = r.competition_id
    JOIN sport_edition e ON e.id = c.edition_id
    WHERE r.person_id IN (${listaUuid(ids)})
      AND r.source_club IS NOT NULL AND trim(r.source_club) <> ''
    ORDER BY (${FECHA_ORDEN_RESULTADO}) DESC, r.competition_id DESC
    LIMIT ${LIMITE_CLUBES_RECIENTES}`;
}

/**
 * Dos filas bastan para saber si el ID FIE confirmado del grupo es único. El
 * `+scheme` evita que SQLite entre por sport_external_id_lookup_idx y lea todos
 * los IDs FIE en vez de los de la persona.
 */
export function sqlIdFieConfirmado(ids: readonly string[]) {
  return sql`
    SELECT DISTINCT value AS valor FROM sport_external_id
    WHERE person_id IN (${listaUuid(ids)})
      AND +scheme = 'fie_addr_id' AND scope_source = 'fie' AND link_status = 'CONFIRMADO'
    ORDER BY value LIMIT 2`;
}

export type FilaMejorRanking = {
  puesto: number;
  total: number | null;
  fuente: string;
  temporada: string;
  arma: string;
  categoria: string;
  categoriaRaw: string | null;
};

/** Mejor puesto individual en cualquier lista oficial importada (por `sport_ranking_entry_person_idx`). */
export function sqlMejorRanking(ids: readonly string[]) {
  return sql`
    SELECT e.position AS puesto, p.published_total AS total, p.source AS fuente,
           p.season AS temporada, p.weapon AS arma, p.category AS categoria,
           p.category_raw AS "categoriaRaw"
    FROM sport_ranking_entry e JOIN sport_ranking_publication p ON p.id = e.publication_id
    WHERE e.person_id IN (${listaUuid(ids)}) AND p.format = 'INDIVIDUAL' AND e.position > 0
    ORDER BY e.position ASC, p.published_on DESC, p.id
    LIMIT 1`;
}
