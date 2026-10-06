import { sql, type SQL } from 'drizzle-orm';
import { FECHA_EDICION, MAX_TOCADOS_INDIVIDUAL } from './asaltos-orientados-sql';
import { listaUuid } from './filtros-sql';
import { LIMITE_PRUEBAS_AMBITO, type FilaPruebaAmbito } from './stats-ambito';
import { PUESTO_SIN_CLASIFICAR } from './tipo-competicion';

/** Pruebas leídas como máximo para las gráficas del perfil (las mismas que las estadísticas por ámbito). */
export const LIMITE_PRUEBAS_RENDIMIENTO = LIMITE_PRUEBAS_AMBITO;
/** Asaltos y pruebas comunes leídos como máximo en un cara a cara. */
export const LIMITE_CARA_A_CARA_RENDIMIENTO = 600;

/**
 * Una fila por prueba individual (equivalencias de calendario fundidas) con
 * su puesto, el balance de asaltos separado por fase y el tamaño del cuadro.
 * Las columnas son un superconjunto de `sqlPruebasAmbito`, así que estas
 * filas sirven también para `aEstadisticasPorAmbito`.
 *
 * El tamaño del cuadro es el mayor puesto publicado de la prueba (por
 * `sport_result_competition_position_idx`, una búsqueda por prueba): no hay
 * columna de inscritos y contar la clasificación entera costaba diez veces más.
 */
export function sqlPruebasRendimiento(ids: readonly string[]): SQL {
  const fase = (nombre: 'POULE' | 'TABLEAU', alias: string) => sql.raw(`
             sum(fase = '${nombre}') AS "${alias}A",
             sum(fase = '${nombre}' AND favor > contra) AS "${alias}V",
             sum(fase = '${nombre}' AND favor < contra) AS "${alias}D",
             coalesce(sum(CASE WHEN fase = '${nombre}' THEN favor END), 0) AS "${alias}Dados",
             coalesce(sum(CASE WHEN fase = '${nombre}' THEN contra END), 0) AS "${alias}Recibidos"`);
  const medidas = ['asaltos', 'victorias', 'derrotas', 'dados', 'recibidos',
    'pouleA', 'pouleV', 'pouleD', 'pouleDados', 'pouleRecibidos',
    'directaA', 'directaV', 'directaD', 'directaDados', 'directaRecibidos'];
  const nulos = sql.raw(medidas.map((m) => `NULL AS "${m}"`).join(', '));
  const deAsaltos = sql.raw(medidas.map((m) => `a."${m}"`).join(', '));
  const sumas = sql.raw(medidas.map((m) => `coalesce(sum("${m}"), 0) AS "${m}"`).join(',\n             '));
  const deFila = sql.raw(medidas.map((m) => `t."${m}"`).join(', '));
  // Sólo las columnas que hacen falta y agregadas por prueba en la misma
  // pasada: sin fechas por asalto ni subconsultas a la edición, el recorrido
  // de los asaltos cuesta la mitad que con `sqlAsaltosOrientados`.
  const rama = (favor: string, contra: string) => sql.raw(`
        SELECT b.competition_id AS prueba, b.phase AS fase, b.${favor} AS favor, b.${contra} AS contra,
               c.event_competition_id AS calendario
        FROM sport_bout b CROSS JOIN sport_competition c ON c.id = b.competition_id`);
  const individual = sql.raw(
    `c.format = 'INDIVIDUAL' AND max(b.score_a, b.score_b) <= ${MAX_TOCADOS_INDIVIDUAL}`,
  );
  return sql`
    WITH por_asaltos AS MATERIALIZED (
      SELECT prueba, coalesce('cal:' || min(calendario), 'sport:' || prueba) AS equivalencia,
             count(*) AS asaltos, sum(favor > contra) AS victorias, sum(favor < contra) AS derrotas,
             sum(favor) AS dados, sum(contra) AS recibidos,
             ${fase('POULE', 'poule')}, ${fase('TABLEAU', 'directa')}
      FROM (
        ${rama('score_a', 'score_b')}
        WHERE b.fencer_a_person_id IN (${listaUuid(ids)}) AND ${individual}
        UNION ALL
        ${rama('score_b', 'score_a')}
        WHERE b.fencer_b_person_id IN (${listaUuid(ids)}) AND ${individual}
          AND (b.fencer_a_person_id IS NULL OR b.fencer_a_person_id NOT IN (${listaUuid(ids)}))
      ) GROUP BY prueba
    ), elegidas AS (
      -- Dos fuentes con equivalencia explícita: cuentan los asaltos de la prueba de menor ID.
      SELECT equivalencia, min(prueba) AS prueba FROM por_asaltos GROUP BY equivalencia
    ), hechos AS (
      SELECT coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia,
             c.id AS prueba,
             coalesce(CASE WHEN r.position > 0 AND r.position < ${PUESTO_SIN_CLASIFICAR} THEN r.position END, -1) AS puesto,
             c.id || '|' || r.id AS resultado, ${nulos}
      FROM sport_result r CROSS JOIN sport_competition c ON c.id = r.competition_id
      WHERE r.person_id IN (${listaUuid(ids)}) AND c.format = 'INDIVIDUAL'
      UNION ALL
      SELECT a.equivalencia, a.prueba, NULL, NULL, ${deAsaltos}
      FROM por_asaltos a JOIN elegidas el ON el.prueba = a.prueba
    ), por_prueba AS (
      SELECT equivalencia, min(prueba) AS prueba,
             CASE WHEN min(puesto) = max(puesto) AND min(puesto) > 0 THEN min(puesto) END AS puesto,
             ${sumas},
             min(resultado) AS resultado
      FROM hechos GROUP BY equivalencia
    )
    SELECT t.prueba AS "pruebaId", c.source AS fuente, e.name AS torneo, c.category AS categoria,
           e.country_code AS pais, ev0.scope AS "ambitoEvento", ev0.circuit AS "circuitoEvento",
           ev0.source AS "fuenteEvento", t.puesto AS puesto, ${deFila},
           (SELECT max(x.position) FROM sport_result x
            WHERE x.competition_id = coalesce(rr.competition_id, t.prueba)
              AND x.position > 0 AND x.position < ${PUESTO_SIN_CLASIFICAR}) AS participantes,
           rr.id AS "resultadoId",
           CASE WHEN rr.position > 0 THEN rr.position END AS "puestoResultado", rr.source AS "fuenteResultado",
           e.id AS "edicionId", c.weapon AS arma, c.gender AS genero, c.season AS temporada,
           coalesce(rr.occurred_on, c.competition_date, e.start_date) AS fecha,
           coalesce(rr.occurred_on, c.competition_date, e.start_date, '0001-01-01') AS "fechaOrden"
    FROM por_prueba t
    CROSS JOIN sport_competition c ON c.id = t.prueba
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id
    LEFT JOIN sport_result rr ON rr.id = substr(t.resultado, instr(t.resultado, '|') + 1)
    ORDER BY coalesce(c.competition_date, e.start_date, '0001-01-01') DESC, t.prueba
    LIMIT ${LIMITE_PRUEBAS_RENDIMIENTO + 1}`;
}

export type FilaPruebaRendimiento = FilaPruebaAmbito & {
  pruebaId: string;
  pouleA: number;
  pouleV: number;
  pouleD: number;
  pouleDados: number;
  pouleRecibidos: number;
  directaA: number;
  directaV: number;
  directaD: number;
  directaDados: number;
  directaRecibidos: number;
  /** Mayor puesto publicado de la prueba; `null` si no hay clasificación. */
  participantes: number | null;
};

/**
 * Cara a cara para las gráficas, en una sola sentencia: los asaltos entre las
 * dos personas (orientados hacia `yo`, una fuente por equivalencia de
 * calendario) y las pruebas individuales en las que ambas tienen puesto.
 *
 * Cada lado de la pareja entra por su índice (`sport_bout_a_idx` empieza por
 * el tirador A y sigue por el B): dos ramas en vez de un OR, que SQLite
 * resolvía recorriendo todos los asaltos de una de las dos.
 */
export function sqlCaraACaraRendimiento(yo: readonly string[], rival: readonly string[]): SQL {
  const columnas = (mios: string, suyos: string) => sql.raw(`
      b.id AS id, b.competition_id AS prueba, b.phase AS fase, b.${mios} AS mios, b.${suyos} AS suyos,
      coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia,
      coalesce(b.occurred_on, c.competition_date, ${FECHA_EDICION}, '0001-01-01') AS fecha_orden`);
  const individual = sql.raw(
    `c.format = 'INDIVIDUAL' AND max(b.score_a, b.score_b) <= ${MAX_TOCADOS_INDIVIDUAL}`,
  );
  const ambos = listaUuid([...yo, ...rival]);
  return sql`
    WITH pareja AS MATERIALIZED (
      SELECT ${columnas('score_a', 'score_b')}
      FROM sport_bout b CROSS JOIN sport_competition c ON c.id = b.competition_id
      WHERE b.fencer_a_person_id IN (${listaUuid(yo)}) AND b.fencer_b_person_id IN (${listaUuid(rival)}) AND ${individual}
      UNION ALL
      SELECT ${columnas('score_b', 'score_a')}
      FROM sport_bout b CROSS JOIN sport_competition c ON c.id = b.competition_id
      WHERE b.fencer_a_person_id IN (${listaUuid(rival)}) AND b.fencer_b_person_id IN (${listaUuid(yo)}) AND ${individual}
    ), elegidas AS (
      SELECT equivalencia, min(prueba) AS prueba FROM pareja GROUP BY equivalencia
    ), asaltos AS (
      SELECT p.* FROM pareja p JOIN elegidas el ON el.prueba = p.prueba
      ORDER BY p.fecha_orden, p.fase = 'TABLEAU', p.id
      LIMIT ${LIMITE_CARA_A_CARA_RENDIMIENTO}
    ), puestos AS MATERIALIZED (
      -- Los resultados de las dos se leen una vez (person_date_idx) y se agrupan por prueba.
      SELECT r.competition_id AS prueba,
             min(CASE WHEN r.person_id IN (${listaUuid(yo)}) AND r.position > 0 AND r.position < ${PUESTO_SIN_CLASIFICAR} THEN r.position END) AS yo,
             min(CASE WHEN r.person_id IN (${listaUuid(rival)}) AND r.position > 0 AND r.position < ${PUESTO_SIN_CLASIFICAR} THEN r.position END) AS rival
      FROM sport_result r WHERE r.person_id IN (${ambos})
      GROUP BY r.competition_id
      HAVING yo IS NOT NULL AND rival IS NOT NULL
    ), comunes AS (
      SELECT prueba, yo, rival FROM (
        SELECT pu.*, row_number() OVER (
          PARTITION BY coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) ORDER BY pu.prueba
        ) AS n
        FROM puestos pu CROSS JOIN sport_competition c ON c.id = pu.prueba
        WHERE c.format = 'INDIVIDUAL'
      ) WHERE n = 1
      LIMIT ${LIMITE_CARA_A_CARA_RENDIMIENTO}
    ), filas AS (
      SELECT 'asalto' AS clase, a.prueba, a.fase, a.mios, a.suyos, NULL AS "puestoYo", NULL AS "puestoRival",
             a.fecha_orden AS "fechaOrden", a.id AS orden
      FROM asaltos a
      UNION ALL
      SELECT 'prueba', cm.prueba, NULL, NULL, NULL, cm.yo, cm.rival, NULL, cm.prueba FROM comunes cm
    )
    SELECT f.clase, f.prueba AS "pruebaId", f.fase, f.mios, f.suyos, f."puestoYo", f."puestoRival",
           coalesce(f."fechaOrden", c.competition_date, e.start_date, '0001-01-01') AS "fechaOrden",
           coalesce(c.competition_date, e.start_date) AS "fechaPrueba",
           c.season AS temporada, c.category AS categoria, c.weapon AS arma, c.gender AS genero,
           c.source AS fuente, e.id AS "edicionId", e.name AS torneo, e.country_code AS pais,
           ev0.scope AS "ambitoEvento", ev0.circuit AS "circuitoEvento", ev0.source AS "fuenteEvento",
           CASE WHEN f.clase = 'prueba' THEN (
             SELECT max(x.position) FROM sport_result x
             WHERE x.competition_id = f.prueba AND x.position > 0 AND x.position < ${PUESTO_SIN_CLASIFICAR}
           ) END AS participantes
    FROM filas f
    CROSS JOIN sport_competition c ON c.id = f.prueba
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id
    ORDER BY "fechaOrden", f.clase, f.fase = 'TABLEAU', f.orden`;
}

export type FilaCaraACaraRendimiento = {
  clase: 'asalto' | 'prueba';
  pruebaId: string;
  fase: 'POULE' | 'TABLEAU' | null;
  mios: number | null;
  suyos: number | null;
  puestoYo: number | null;
  puestoRival: number | null;
  fechaOrden: string;
  fechaPrueba: string | null;
  temporada: string;
  categoria: string;
  arma: string;
  genero: string;
  fuente: string;
  edicionId: string;
  torneo: string;
  pais: string | null;
  ambitoEvento: string | null;
  circuitoEvento: string | null;
  fuenteEvento: string | null;
  participantes: number | null;
};
