import { CODIGOS_PAIS } from './pais-codigos';
import { PUESTO_SIN_CLASIFICAR } from './tipo-competicion';

/**
 * Reconstrucción completa de los agregados por país (migración 0018), junto al
 * índice de palabras de Explorar (`SENTENCIAS_RECONSTRUCCION` en
 * `indice-sql.ts`, que aplica `scripts/indice-explorar.ts`). Sólo escribe en
 * `explorar_pais_*`. Va en la misma transacción que el índice: quien lee ve los
 * agregados anteriores o los nuevos, nunca unos a medias.
 *
 * Los asaltos se recorren una vez (`explorar_pais_prueba`, repartida en
 * `TROZOS` sentencias por pruebas para que ninguna se acerque al límite de
 * duración de D1); los totales por rival salen de esa tabla, y el resumen y
 * los podios, de los resultados. Ninguna petición vuelve a recorrer
 * `sport_bout`.
 *
 * Qué cuenta:
 *   - sólo pruebas internacionales: FIE, EFC, una edición fuera de España o un
 *     evento del calendario internacional;
 *   - el país de cada hecho es el que publica la fuente en esa prueba
 *     (`source_country_code`) y, si falta, el de la ficha de la persona (la que
 *     prevalece); un código que no es un país no cuenta;
 *   - los resultados de una prueba conjunta (0013) no cuentan: sus partes ya
 *     tienen los puestos;
 *   - los encuentros por equipos son los asaltos de las pruebas por equipos,
 *     cuyos dos lados son las filas de equipo de `sport_result`.
 *
 * Medido en el D1 local (workerd) con la copia de producción: buscar el
 * resultado de cada lado de cada asalto en `sport_result_key` costaba 30-55 s
 * por tramo; ordenar lados y resultados juntos y repartir el país con una
 * ventana (`max() OVER`) es varias veces más rápido: ~10 s por trozo de ocho.
 */
export const VERSION_PAISES = 1;

/** Sentencias en que se reparten las pruebas al recorrer los asaltos. */
export const TROZOS = 8;

const SIN_PUESTO = PUESTO_SIN_CLASIFICAR;

/** Temporada como en el perfil (`temporadaDeportiva`): la FIE guarda «2025», el resto «2024-2025». */
const TEMPORADA = `CASE WHEN c.season GLOB '[0-9][0-9][0-9][0-9]'
      THEN (CAST(c.season AS integer) - 1) || '-' || c.season ELSE c.season END`;

const MODALIDAD = `CASE c.format WHEN 'EQUIPOS' THEN 'E' ELSE 'I' END`;

export const INTERNACIONAL_SQL = `(c.source IN ('fie', 'efc')
      OR (e.country_code IS NOT NULL AND e.country_code NOT IN ('ESP', 'ES'))
      OR ev.scope = 'INTERNACIONAL')`;

const FECHA = `coalesce(c.competition_date, e.start_date, '')`;

/**
 * El país de un resultado: el publicado en la prueba si es un país; si no, el
 * de la ficha (la que prevalece y, si no lo tiene, la propia). `coalesce`
 * evalúa en orden y se detiene en el primero no nulo, así que la ficha sólo se
 * lee cuando la prueba no trae país: leerla para cada resultado costaba 30 s.
 */
const paisDeResultado = `coalesce(
      (SELECT codigo FROM explorar_pais_codigo WHERE codigo = r.source_country_code),
      (SELECT k.codigo FROM sport_person p
         LEFT JOIN sport_person q ON q.id = p.merged_into_person_id
         CROSS JOIN explorar_pais_codigo k ON k.codigo = coalesce(q.country_code, p.country_code)
       WHERE p.id = r.person_id))`;

/** Personas fundidas (pocas): la que prevalece sin leer la ficha de cada resultado. */
const FUNDIDAS = `fundidas(id, raiz) AS MATERIALIZED (
    SELECT id, merged_into_person_id FROM sport_person WHERE merged_into_person_id IS NOT NULL
  )`;

const internacionales = (filtro = '') => `pruebas AS MATERIALIZED (
    SELECT c.id, c.weapon AS arma, c.gender AS genero, c.category AS categoria,
           ${MODALIDAD} AS modalidad, ${TEMPORADA} AS temporada, ${FECHA} AS fecha
    FROM sport_competition c
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev ON ev.id = e.event_id
    WHERE ${INTERNACIONAL_SQL}${filtro}
  )`;

/** Resultados internacionales con su país y la persona que prevalece; sin las pruebas conjuntas. */
const RESULTADOS = `${FUNDIDAS}, ${internacionales()},
  base AS MATERIALIZED (
    SELECT r.id AS resultado, r.competition_id AS prueba, ${paisDeResultado} AS pais,
      CASE WHEN x.modalidad = 'I' THEN coalesce(f.raiz, r.person_id) END AS persona,
      x.arma, x.genero, x.categoria, x.modalidad, x.temporada, x.fecha,
      CASE WHEN r.position >= 1 AND r.position < ${SIN_PUESTO} THEN r.position END AS puesto
    FROM sport_result r
    CROSS JOIN pruebas x ON x.id = r.competition_id
    LEFT JOIN fundidas f ON f.id = r.person_id
    WHERE x.id NOT IN (SELECT combined_competition_id FROM sport_competition_combined)
  )`;

/** La misma definición que en la 0018 (lo comprueba `tests/explorar-pais.test.ts`). */
export const TABLA_PRUEBA = `CREATE TABLE IF NOT EXISTS explorar_pais_prueba (
  pais_a TEXT NOT NULL,
  pais_b TEXT NOT NULL,
  fecha TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  arma TEXT NOT NULL,
  genero TEXT NOT NULL,
  categoria TEXT NOT NULL,
  modalidad TEXT NOT NULL,
  temporada TEXT NOT NULL,
  asaltos INTEGER NOT NULL,
  victorias_a INTEGER NOT NULL,
  victorias_b INTEGER NOT NULL,
  tocados_a INTEGER NOT NULL,
  tocados_b INTEGER NOT NULL,
  asaltos_ids TEXT NOT NULL
)`;

export const INDICES_PRUEBA: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS explorar_pais_prueba_pareja_idx
  ON explorar_pais_prueba (pais_a, pais_b, fecha, competition_id)`,
  `CREATE INDEX IF NOT EXISTS explorar_pais_prueba_filtro_idx
  ON explorar_pais_prueba (pais_a, pais_b, arma, genero, categoria, fecha, competition_id)`,
];

const mascara = (bit: number, columna: string) => `CASE WHEN k & ${bit} THEN ${columna} ELSE '' END`;

/**
 * Un trozo de las pruebas (las de `rowid % trozos = trozo`): sus resultados y
 * los dos lados de cada asalto, ordenados juntos por prueba y clave de la
 * fuente, de modo que cada lado recibe el país de su fila de resultado sin
 * buscarla. Se agrupa por prueba y pareja de países. El id de un asalto cuyo
 * lado A es el país mayor de la pareja va con `~` delante: así la lista de
 * cruces sabe de qué lado está cada país sin volver a buscarlo.
 */
export function sqlPruebasDeTrozo(trozo: number, trozos = TROZOS): string {
  return `INSERT INTO explorar_pais_prueba (pais_a, pais_b, fecha, competition_id, arma, genero, categoria, modalidad, temporada,
      asaltos, victorias_a, victorias_b, tocados_a, tocados_b, asaltos_ids)
  WITH ${internacionales(` AND c.rowid % ${trozos} = ${trozo}`)},
  lados(prueba, clave, pais, asalto, lado, ta, tb) AS (
    SELECT r.competition_id, r.source_fact_key, ${paisDeResultado}, NULL, NULL, NULL, NULL
    FROM sport_result r CROSS JOIN pruebas x ON x.id = r.competition_id
    UNION ALL
    SELECT b.competition_id, CASE l.n WHEN 0 THEN b.fencer_a_ref ELSE b.fencer_b_ref END, NULL, b.id, l.n, b.score_a, b.score_b
    FROM sport_bout b CROSS JOIN pruebas x ON x.id = b.competition_id
    CROSS JOIN (SELECT 0 AS n UNION ALL SELECT 1) l
  ),
  repartidos AS (
    SELECT prueba, asalto, lado, ta, tb, max(pais) OVER (PARTITION BY prueba, clave) AS pais FROM lados
  ),
  asaltos AS (
    SELECT asalto AS id, prueba, max(CASE lado WHEN 0 THEN pais END) AS pa, max(CASE lado WHEN 1 THEN pais END) AS pb,
      max(ta) AS ta, max(tb) AS tb
    FROM repartidos WHERE asalto IS NOT NULL
    GROUP BY asalto
  ),
  orientados AS (
    SELECT CASE WHEN pa < pb THEN id ELSE '~' || id END AS id, prueba,
      CASE WHEN pa < pb THEN pa ELSE pb END AS p1,
      CASE WHEN pa < pb THEN pb ELSE pa END AS p2,
      CASE WHEN pa < pb THEN ta ELSE tb END AS t1,
      CASE WHEN pa < pb THEN tb ELSE ta END AS t2
    FROM asaltos
    WHERE pa <> pb
  )
  SELECT o.p1, o.p2, x.fecha, o.prueba, x.arma, x.genero, x.categoria, x.modalidad, x.temporada,
    count(*), sum(o.t1 > o.t2), sum(o.t2 > o.t1), sum(o.t1), sum(o.t2), json_group_array(o.id)
  FROM orientados o CROSS JOIN pruebas x ON x.id = o.prueba
  GROUP BY o.p1, o.p2, o.prueba`;
}

export const SENTENCIAS_PAISES: readonly string[] = [
  'DELETE FROM explorar_pais_estado',
  'DELETE FROM explorar_pais_codigo',
  'DELETE FROM explorar_pais_resumen',
  'DELETE FROM explorar_pais_tiradores',
  'DELETE FROM explorar_pais_medalla',
  // La tabla grande se tira y se crea en vez de vaciarla: D1 cuenta cada fila
  // borrada como escrita (586.000 por reconstrucción). Es una tabla con rowid
  // y sin clave: cada trozo sólo añade al final, y sus índices se crean al
  // final de una vez. Con la clave, cada trozo insertaba por todo el árbol y
  // tardaba más que el anterior (de 9 a 25 s).
  'DROP TABLE IF EXISTS explorar_pais_prueba',
  TABLA_PRUEBA,
  'DELETE FROM explorar_pais_rival',
  `INSERT INTO explorar_pais_codigo (codigo) VALUES ${CODIGOS_PAIS.map((c) => `('${c}')`).join(', ')}`,

  ...Array.from({ length: TROZOS }, (_, i) => sqlPruebasDeTrozo(i)),
  ...INDICES_PRUEBA,

  `INSERT INTO explorar_pais_rival (pais_a, pais_b, asaltos, victorias, derrotas, encuentros, ganados, perdidos, ultima)
  WITH dos(pais_a, pais_b, modalidad, temporada, asaltos, victorias, derrotas) AS (
    SELECT pais_a, pais_b, modalidad, temporada, asaltos, victorias_a, victorias_b FROM explorar_pais_prueba
    UNION ALL
    SELECT pais_b, pais_a, modalidad, temporada, asaltos, victorias_b, victorias_a FROM explorar_pais_prueba
  )
  SELECT pais_a, pais_b,
    sum(CASE WHEN modalidad = 'I' THEN asaltos ELSE 0 END),
    sum(CASE WHEN modalidad = 'I' THEN victorias ELSE 0 END),
    sum(CASE WHEN modalidad = 'I' THEN derrotas ELSE 0 END),
    sum(CASE WHEN modalidad = 'E' THEN asaltos ELSE 0 END),
    sum(CASE WHEN modalidad = 'E' THEN victorias ELSE 0 END),
    sum(CASE WHEN modalidad = 'E' THEN derrotas ELSE 0 END),
    max(temporada)
  FROM dos GROUP BY 1, 2`,

  // El resumen por la combinación más fina: la pantalla suma las filas de sus
  // filtros (unos cientos por país). `tiradores` sólo es exacto en su fila.
  `INSERT INTO explorar_pais_resumen (pais, arma, genero, categoria, modalidad, temporada,
      pruebas, resultados, tiradores, oros, platas, bronces, finales, mejor)
  WITH ${RESULTADOS}
  SELECT pais, arma, genero, categoria, modalidad, temporada,
    count(DISTINCT prueba), count(*), count(DISTINCT persona),
    count(CASE WHEN puesto = 1 THEN 1 END), count(CASE WHEN puesto = 2 THEN 1 END),
    count(CASE WHEN puesto = 3 THEN 1 END), count(CASE WHEN puesto <= 8 THEN 1 END), min(puesto)
  FROM base WHERE pais IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5, 6`,

  // Las personas distintas no se pueden sumar: van con sus ocho combinaciones
  // de arma, género y categoría ('' = todas). Sólo hay personas en individual.
  `INSERT INTO explorar_pais_tiradores (pais, arma, genero, categoria, tiradores)
  WITH RECURSIVE ${RESULTADOS},
  mascaras(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM mascaras WHERE k < 7),
  personas AS MATERIALIZED (
    SELECT DISTINCT pais, persona, arma, genero, categoria FROM base WHERE pais IS NOT NULL AND persona IS NOT NULL
  )
  SELECT pais, ${mascara(1, 'arma')}, ${mascara(2, 'genero')}, ${mascara(4, 'categoria')}, count(DISTINCT persona)
  FROM personas CROSS JOIN mascaras
  GROUP BY 1, 2, 3, 4`,

  `INSERT OR IGNORE INTO explorar_pais_medalla (pais, fecha, resultado_id, competition_id, persona_id, puesto,
      arma, genero, categoria, modalidad, temporada)
  WITH ${RESULTADOS}
  SELECT pais, fecha, resultado, prueba, persona, puesto, arma, genero, categoria, modalidad, temporada
  FROM base WHERE pais IS NOT NULL AND puesto BETWEEN 1 AND 3`,

  `INSERT INTO explorar_pais_estado (key, version, construido_en)
  VALUES ('global', ${VERSION_PAISES}, cast(strftime('%s', 'now') AS integer) * 1000)`,
];
