import { sql } from 'drizzle-orm';
import { FECHA_ORDEN_RESULTADO, listaUuid } from './filtros-sql';

export const LIMITE_SUGERIDOS = 12;
/** Pruebas individuales más recientes de la ficha en las que se buscan coincidencias. */
export const VENTANA_PRUEBAS_SUGERIDOS = 20;
/** Candidatos en bruto (antes de juntar fusiones) que pasan a la segunda fase. */
const CANDIDATOS_BRUTOS = 48;
/** A partir de cuántos asaltos un rival es «frecuente». */
export const ASALTOS_RIVAL_FRECUENTE = 5;

export type FilaSugerido = {
  id: string;
  nombre: string;
  pais: string | null;
  club: string | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
  pruebas: number;
  mismoClub: number;
};

/**
 * Tiradores sugeridos para una ficha: rivales con asaltos importados y
 * personas que coinciden en sus pruebas recientes, con el mismo club
 * publicado en alguna de ellas. Todo sale de hechos ya importados; nada se
 * deduce por el nombre.
 *
 * Dos fases para que el coste no dependa de lo larga que sea la carrera:
 *
 * 1. Orden aproximado y barato. Coincidencias en las
 *    `VENTANA_PRUEBAS_SUGERIDOS` pruebas individuales más recientes
 *    (`sport_result_person_date_idx` y luego la clasificación de cada prueba
 *    por `sport_result_competition_position_idx`) y asaltos contados sólo con
 *    `sport_bout_a_idx` / `sport_bout_b_idx`, sin leer la tabla. Coincidencias
 *    y asaltos se agrupan por ID en un único GROUP BY (`por_pid`), que guarda
 *    además lo que necesita la fase 2 (equivalencias en JSON, club más
 *    reciente): D1 cobra cada fila leída de una tabla temporal, y releer las
 *    ~3 000 coincidencias de una ficha grande duplicaba el coste. Se queda con
 *    `CANDIDATOS_BRUTOS` IDs, y sólo esos se llevan a su persona canónica.
 * 2. Cifras exactas para los elegidos, que son las que se enseñan: asaltos
 *    individuales (sin equipos y sin duplicar pruebas con equivalencia
 *    explícita, como `asaltosValidos`), pruebas compartidas contadas por
 *    equivalencia y el club de la más reciente.
 *
 * Fusiones: un único salto hasta la persona que prevalece (no hay cadenas);
 * si esa persona estuviera fundida a su vez se descarta en vez de elegir una.
 * Los hechos colgados de una ficha fundida suman en la que prevalece. La
 * propia ficha y sus fusionadas nunca se sugieren.
 *
 * Sin `sqlite_stat1` el planificador puede empezar por el lado equivocado:
 * los CROSS JOIN fijan el orden (primero lo de la persona, luego lo demás).
 */
export function sqlTiradoresSugeridos(ids: readonly string[], canonicaId: string) {
  // `NOT IN (SELECT value FROM grupo)` cuesta en D1 una fila leída por cada
  // fila comprobada; buscar el ID entre comillas en el JSON del grupo no lee
  // nada. Equivale porque los IDs no llevan comillas ni barras invertidas.
  const json = JSON.stringify(ids);
  const fuera = (columna: string) => sql`instr(${json}, '"' || ${sql.raw(columna)} || '"') = 0`;
  return sql`
    WITH grupo AS MATERIALIZED (${listaUuid(ids)}),
    mias AS MATERIALIZED (
      SELECT r.competition_id AS prueba,
             coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia,
             max(r.source_club) AS club,
             max(${FECHA_ORDEN_RESULTADO}) AS fecha_orden
      FROM sport_result r
      CROSS JOIN sport_competition c ON c.id = r.competition_id
      CROSS JOIN sport_edition e ON e.id = c.edition_id
      WHERE r.person_id IN (SELECT value FROM grupo) AND c.format = 'INDIVIDUAL'
      GROUP BY r.competition_id
      ORDER BY fecha_orden DESC, r.competition_id DESC
      LIMIT ${VENTANA_PRUEBAS_SUGERIDOS}
    ), por_pid AS MATERIALIZED (
      SELECT pid, sum(prueba) AS pruebas, max(mismo) AS mismo, sum(asalto) AS asaltos,
             json_group_array(equivalencia) FILTER (WHERE prueba = 1) AS equivalencias,
             max(club_orden) AS club_orden
      FROM (
        SELECT o.person_id AS pid, 1 AS prueba, 0 AS asalto, m.equivalencia AS equivalencia,
               CASE WHEN trim(coalesce(m.club, '')) <> '' AND o.source_club = m.club THEN 1 ELSE 0 END AS mismo,
               CASE WHEN trim(coalesce(o.source_club, '')) <> ''
                    THEN m.fecha_orden || m.prueba || '|' || o.source_club END AS club_orden
        FROM mias m
        CROSS JOIN sport_result o ON o.competition_id = m.prueba
        WHERE o.person_id IS NOT NULL
        UNION ALL
        SELECT b.fencer_b_person_id, 0, 1, NULL, 0, NULL FROM sport_bout b
        WHERE b.fencer_a_person_id IN (SELECT value FROM grupo) AND b.fencer_b_person_id IS NOT NULL
        UNION ALL
        SELECT b.fencer_a_person_id, 0, 1, NULL, 0, NULL FROM sport_bout b
        WHERE b.fencer_b_person_id IN (SELECT value FROM grupo) AND b.fencer_a_person_id IS NOT NULL
      )
      GROUP BY pid
      HAVING ${fuera('pid')}
    ), primeros AS MATERIALIZED (
      SELECT pid, pruebas, mismo, asaltos FROM por_pid
      ORDER BY asaltos * 5 + pruebas + mismo * 10 DESC, pid
      LIMIT ${CANDIDATOS_BRUTOS}
    ), elegidos AS MATERIALIZED (
      SELECT rp.id AS id, rp.display_name AS nombre, rp.country_code AS pais,
             sum(x.asaltos) * 5 + sum(x.pruebas) + max(x.mismo) * 10 AS peso
      FROM primeros x
      CROSS JOIN sport_person p ON p.id = x.pid
      CROSS JOIN sport_person rp ON rp.id = coalesce(p.merged_into_person_id, p.id)
      WHERE rp.merged_into_person_id IS NULL AND rp.id <> ${canonicaId}
      GROUP BY rp.id
      ORDER BY peso DESC, rp.id
      LIMIT ${LIMITE_SUGERIDOS}
    ), miembros AS MATERIALIZED (
      SELECT el.id AS raiz, el.id AS pid FROM elegidos el
      UNION ALL
      SELECT el.id, p.id FROM elegidos el
      CROSS JOIN sport_person p ON p.merged_into_person_id = el.id
    ), juntas AS (
      SELECT mb.raiz AS raiz, count(DISTINCT je.value) AS pruebas, max(pp.mismo) AS mismo,
             max(pp.club_orden) AS club_orden
      FROM miembros mb CROSS JOIN por_pid pp ON pp.pid = mb.pid
      CROSS JOIN json_each(pp.equivalencias) je
      GROUP BY mb.raiz
    ), pares AS MATERIALIZED (
      SELECT mb.raiz AS raiz, b.competition_id AS prueba, b.score_a AS favor, b.score_b AS contra
      FROM miembros mb CROSS JOIN sport_bout b
      WHERE b.fencer_b_person_id = mb.pid AND b.fencer_a_person_id IN (SELECT value FROM grupo)
      UNION ALL
      SELECT mb.raiz, b.competition_id, b.score_b, b.score_a
      FROM miembros mb CROSS JOIN sport_bout b
      WHERE b.fencer_a_person_id = mb.pid AND b.fencer_b_person_id IN (SELECT value FROM grupo)
    ), pares_validos AS MATERIALIZED (
      SELECT pa.raiz, pa.prueba, pa.favor, pa.contra,
             coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia
      FROM pares pa CROSS JOIN sport_competition c ON c.id = pa.prueba
      WHERE c.format = 'INDIVIDUAL'
    ), una_fuente AS (
      SELECT raiz, equivalencia, min(prueba) AS prueba FROM pares_validos GROUP BY raiz, equivalencia
    ), asaltos AS (
      SELECT pv.raiz AS raiz, count(*) AS asaltos,
             sum(CASE WHEN pv.favor > pv.contra THEN 1 ELSE 0 END) AS victorias,
             sum(CASE WHEN pv.favor < pv.contra THEN 1 ELSE 0 END) AS derrotas
      FROM pares_validos pv
      JOIN una_fuente u ON u.raiz = pv.raiz AND u.equivalencia = pv.equivalencia AND u.prueba = pv.prueba
      GROUP BY pv.raiz
    )
    SELECT el.id AS id, el.nombre AS nombre, el.pais AS pais,
           substr(j.club_orden, instr(j.club_orden, '|') + 1) AS club,
           coalesce(a.asaltos, 0) AS asaltos, coalesce(a.victorias, 0) AS victorias,
           coalesce(a.derrotas, 0) AS derrotas, coalesce(j.pruebas, 0) AS pruebas,
           coalesce(j.mismo, 0) AS "mismoClub"
    FROM elegidos el
    LEFT JOIN juntas j ON j.raiz = el.id
    LEFT JOIN asaltos a ON a.raiz = el.id
    WHERE coalesce(a.asaltos, 0) > 0 OR coalesce(j.pruebas, 0) >= 2 OR coalesce(j.mismo, 0) = 1
    ORDER BY coalesce(a.asaltos, 0) * 5 + coalesce(j.pruebas, 0) + coalesce(j.mismo, 0) * 10 DESC,
             coalesce(a.asaltos, 0) DESC, el.id`;
}
