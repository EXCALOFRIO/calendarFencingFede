import { sql, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { TIPOS_FIE, TIPOS_SKERMO_SIN_REFINAR } from './estadisticas-tipo';
import { plegarSql } from './filtros-sql';
import { bordesSql, casosTipoPorNombre } from './organizador';
import { CODIGOS_PAIS } from './pais-codigos';
import { PUESTO_SIN_CLASIFICAR } from './tipo-competicion';

/**
 * Reconstrucción completa de los agregados por país (migraciones 0018 y
 * 0021), junto al índice de palabras de Explorar (`SENTENCIAS_RECONSTRUCCION`
 * en `indice-sql.ts`, que aplica `scripts/indice-explorar.ts`). Sólo escribe
 * en `explorar_pais_*`.
 *
 * Los asaltos se recorren dos veces, repartidos en `TROZOS` sentencias por
 * temporadas para que ninguna se acerque al límite de duración de D1: una
 * para `explorar_pais_prueba` (pareja de países y prueba) y otra para
 * `explorar_pais_tirador` (persona y país rival por temporada). Leer es
 * barato en D1 y escribir caro: recorrer los asaltos otra vez sale mucho más
 * barato que guardar un paso intermedio. Los totales por rival salen de la
 * primera, y el resumen y los podios, de los resultados. Ninguna petición
 * vuelve a recorrer `sport_bout`.
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
 *     cuyos dos lados son las filas de equipo de `sport_result`;
 *   - un asalto con el mismo tanteo en los dos lados (0–0 sin publicar, o un
 *     empate que en esgrima no existe y es un dato a medias) no cuenta en
 *     nada: ni asaltos, ni victorias, ni tocados. Así asaltos = victorias +
 *     derrotas en todas las tablas.
 *
 * Medido en el D1 local (workerd) con la copia de producción: buscar el
 * resultado de cada lado de cada asalto en `sport_result_key` costaba 30-55 s
 * por tramo; ordenar lados y resultados juntos y repartir el país con una
 * ventana (`max() OVER`) es varias veces más rápido.
 */
export const VERSION_PAISES = 2;

/**
 * Sentencias en que se reparten las temporadas al recorrer los asaltos, por
 * el año en que empiezan módulo `TROZOS`. Las temporadas grandes son doce
 * seguidas (2014-2025, 75.000-124.000 asaltos cada una): con doce trozos cae
 * una en cada uno; con ocho, algún trozo llevaba dos.
 */
export const TROZOS = 12;

const SIN_PUESTO = PUESTO_SIN_CLASIFICAR;

/** Temporada como en el perfil (`temporadaDeportiva`): la FIE guarda «2025», el resto «2024-2025». */
const TEMPORADA = `CASE WHEN c.season GLOB '[0-9][0-9][0-9][0-9]'
      THEN (CAST(c.season AS integer) - 1) || '-' || c.season ELSE c.season END`;

const MODALIDAD = `CASE c.format WHEN 'EQUIPOS' THEN 'E' ELSE 'I' END`;

export const INTERNACIONAL_SQL = `(c.source IN ('fie', 'efc')
      OR (e.country_code IS NOT NULL AND e.country_code NOT IN ('ESP', 'ES'))
      OR ev.scope = 'INTERNACIONAL')`;

const FECHA = `coalesce(c.competition_date, e.start_date, '')`;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

/** Circuito documentado del calendario → tipo, como `POR_CIRCUITO` de `tipo-competicion.ts`. */
const POR_CIRCUITO: Record<string, string> = {
  SEN_WC: 'COPA_MUNDO', JUN_WC: 'COPA_MUNDO', CAD_WC: 'COPA_MUNDO', SEN_GP: 'GRAN_PREMIO',
  TLM: 'LIGA_MASTER', CONCENTRACION: 'NACIONAL_OTRO',
};
const circuito = (columna: string) =>
  `CASE ${columna} ${Object.entries(POR_CIRCUITO).map(([c, t]) => `WHEN '${c}' THEN '${t}'`).join(' ')} ELSE ${columna} END`;

/** Un fragmento de drizzle como texto: todo son literales, no lleva parámetros. */
function comoTexto(fragmento: SQL): string {
  const q = new SQLiteSyncDialect().sqlToQuery(fragmento);
  if (q.params.length > 0) throw new Error('el fragmento no puede llevar parámetros');
  return q.sql;
}

/**
 * El tipo por nombre de cada edición, calculado por etapas antes de los trozos.
 * D1 rechaza árboles de expresión de más de 100 niveles: el pliegue del nombre
 * (tildes, puntuación y bordes) son ~90 `replace` anidados, y SQLite lo copia
 * dentro de cada `LIKE` al aplanar la subconsulta. Por separado, cada etapa
 * queda muy por debajo del límite.
 */
export const SENTENCIAS_TIPO_EDICION: readonly string[] = [
  'DROP TABLE IF EXISTS explorar_pais_tipo_edicion',
  `CREATE TABLE explorar_pais_tipo_edicion (
  edition_id TEXT PRIMARY KEY,
  t TEXT,
  tipo TEXT
) WITHOUT ROWID`,
  `INSERT INTO explorar_pais_tipo_edicion (edition_id, t)
  SELECT x.id, ${comoTexto(plegarSql(sql.raw('x.name')))} FROM sport_edition x`,
  `UPDATE explorar_pais_tipo_edicion SET t = ${comoTexto(bordesSql(sql.raw('t')))}`,
  `UPDATE explorar_pais_tipo_edicion SET tipo = CASE ${casosTipoPorNombre()} END`,
];

/**
 * El tipo de competición de `clasificarCompeticion` (`tipo-competicion.ts`)
 * en SQL, con los mismos datos que le pasa la ficha de la prueba: circuito
 * documentado del evento vinculado, la regla de la EFC, el nombre de la
 * edición y, si no, la fuente, el ámbito del evento y el país de la sede.
 */
export function sqlTipoCompeticion(): string {
  return `(SELECT CASE
        WHEN ev.source = 'fie' AND ev.circuit IN (${lista(TIPOS_FIE)}) THEN ${circuito('ev.circuit')}
        WHEN ev.source IN ('skermo_rfee', 'skermo_regional') AND ev.circuit IN (${lista(TIPOS_SKERMO_SIN_REFINAR)}) THEN ${circuito('ev.circuit')}
        WHEN c.source = 'efc' THEN CASE WHEN n.tipo = 'CTO_EUROPA' THEN 'CTO_EUROPA' ELSE 'CIRCUITO_EUROPEO' END
        WHEN n.tipo IS NOT NULL THEN n.tipo
        WHEN c.source = 'skermo_regional' OR ev.scope = 'AUTONOMICO' THEN 'AUTONOMICO'
        WHEN c.source IN ('fie', 'efc') OR ev.scope = 'INTERNACIONAL' THEN 'INTERNACIONAL_OTRO'
        WHEN e.country_code IS NOT NULL AND e.country_code <> '' AND e.country_code <> 'ESP' THEN 'INTERNACIONAL_OTRO'
        WHEN c.source = 'rfee_pdf' OR c.source LIKE 'skermo%' OR ev.scope = 'NACIONAL' OR c.source = 'engarde' THEN 'NACIONAL_OTRO'
        ELSE 'OTRO' END
      FROM (SELECT (SELECT k.tipo FROM explorar_pais_tipo_edicion k WHERE k.edition_id = e.id) AS tipo) n)`;
}

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

const internacionales = (filtro = '', conTipo = false) => `pruebas AS MATERIALIZED (
    SELECT c.id, c.weapon AS arma, c.gender AS genero, c.category AS categoria,
           ${MODALIDAD} AS modalidad, ${TEMPORADA} AS temporada, ${FECHA} AS fecha${conTipo ? `,
           ${sqlTipoCompeticion()} AS tipo` : ''}
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

/**
 * La definición de la 0018 más las columnas que añade la 0021 (al final y con
 * valor por defecto, como las deja `ALTER TABLE … ADD COLUMN`). Lo comprueba
 * `tests/explorar-pais.test.ts`.
 */
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
  asaltos_ids TEXT NOT NULL,
  poule_va INTEGER NOT NULL DEFAULT 0,
  poule_vb INTEGER NOT NULL DEFAULT 0,
  directa_va INTEGER NOT NULL DEFAULT 0,
  directa_vb INTEGER NOT NULL DEFAULT 0,
  tipo TEXT NOT NULL DEFAULT ''
)`;

export const INDICES_PRUEBA: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS explorar_pais_prueba_pareja_idx
  ON explorar_pais_prueba (pais_a, pais_b, fecha, competition_id)`,
  `CREATE INDEX IF NOT EXISTS explorar_pais_prueba_filtro_idx
  ON explorar_pais_prueba (pais_a, pais_b, arma, genero, categoria, fecha, competition_id)`,
];

/**
 * La misma definición que en la 0021 (lo comprueba `tests/explorar-pais.test.ts`).
 * Filas por temporada y, con `temporada = ''`, la suma de todas. La clave va
 * por pareja, temporada y persona: la pantalla agrupa por persona recorriendo
 * la clave en orden, sin ordenar aparte (D1 cuenta como leídas también las
 * filas de esa ordenación: el doble). Medido en ITA–FRA, la pareja más grande:
 * sin la suma de todas las temporadas y con el género delante, cada lista leía
 * ~11.000 filas; así, ~3.000.
 */
export const TABLA_TIRADOR = `CREATE TABLE IF NOT EXISTS explorar_pais_tirador (
  pais TEXT NOT NULL,
  rival TEXT NOT NULL,
  temporada TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  genero TEXT NOT NULL,
  arma TEXT NOT NULL,
  categoria TEXT NOT NULL,
  modalidad TEXT NOT NULL,
  asaltos INTEGER NOT NULL,
  victorias INTEGER NOT NULL,
  derrotas INTEGER NOT NULL,
  tf INTEGER NOT NULL,
  tc INTEGER NOT NULL,
  poule_v INTEGER NOT NULL,
  poule_d INTEGER NOT NULL,
  directa_v INTEGER NOT NULL,
  directa_d INTEGER NOT NULL,
  ultima TEXT NOT NULL,
  PRIMARY KEY (pais, rival, temporada, persona_id, genero, arma, categoria, modalidad)
) WITHOUT ROWID`;

/**
 * Tramos de países para sumar todas las temporadas (`temporada = ''`) en
 * sentencias de un cuarto de las filas cada una: cada límite es el primer
 * país del tramo siguiente (medido en la copia de producción).
 */
export const TRAMOS_TIRADOR: readonly string[] = ['GBR', 'JAM', 'RSA'];

const COLUMNAS_TIRADOR = `pais, rival, temporada, persona_id, genero, arma, categoria, modalidad,
      asaltos, victorias, derrotas, tf, tc, poule_v, poule_d, directa_v, directa_d, ultima`;

const mascara = (bit: number, columna: string) => `CASE WHEN k & ${bit} THEN ${columna} ELSE '' END`;

/** Las temporadas del trozo, por el año en que empiezan: las grandes (las recientes) caen en trozos distintos. */
const filtroTrozo = (trozo: number, trozos: number) =>
  trozos > 1 ? ` AND CAST(substr(${TEMPORADA}, 1, 4) AS integer) % ${trozos} = ${trozo}` : '';

/**
 * Los asaltos de las pruebas de `pruebas` entre dos países, sin los de tanteo
 * igual: los resultados y los dos lados de cada asalto, ordenados juntos por
 * prueba y clave de la fuente, de modo que cada lado recibe el país de su fila
 * de resultado sin buscarla.
 */
const ASALTOS = `lados(prueba, clave, pais, asalto, lado, ta, tb, fase, persona) AS (
    SELECT r.competition_id, r.source_fact_key, ${paisDeResultado}, NULL, NULL, NULL, NULL, NULL, NULL
    FROM sport_result r CROSS JOIN pruebas x ON x.id = r.competition_id
    UNION ALL
    SELECT b.competition_id, CASE l.n WHEN 0 THEN b.fencer_a_ref ELSE b.fencer_b_ref END, NULL, b.id, l.n, b.score_a, b.score_b,
      b.phase, CASE l.n WHEN 0 THEN b.fencer_a_person_id ELSE b.fencer_b_person_id END
    FROM sport_bout b CROSS JOIN pruebas x ON x.id = b.competition_id
    CROSS JOIN (SELECT 0 AS n UNION ALL SELECT 1) l
    WHERE b.score_a <> b.score_b
  ),
  repartidos AS (
    SELECT prueba, asalto, lado, ta, tb, fase, persona, max(pais) OVER (PARTITION BY prueba, clave) AS pais FROM lados
  ),
  asaltos AS (
    SELECT asalto AS id, prueba, max(fase) AS fase,
      max(CASE lado WHEN 0 THEN pais END) AS pa, max(CASE lado WHEN 1 THEN pais END) AS pb,
      max(CASE lado WHEN 0 THEN persona END) AS qa, max(CASE lado WHEN 1 THEN persona END) AS qb,
      max(ta) AS ta, max(tb) AS tb
    FROM repartidos WHERE asalto IS NOT NULL
    GROUP BY asalto
  )`;

/**
 * Un trozo de las temporadas: los asaltos agrupados por prueba y pareja de
 * países. El id de un asalto cuyo lado A es el país mayor de la pareja va con
 * `~` delante: así la lista de cruces sabe de qué lado está cada país sin
 * volver a buscarlo.
 */
export function sqlPruebasDeTrozo(trozo: number, trozos = TROZOS): string {
  return `INSERT INTO explorar_pais_prueba (pais_a, pais_b, fecha, competition_id, arma, genero, categoria, modalidad, temporada,
      asaltos, victorias_a, victorias_b, tocados_a, tocados_b, asaltos_ids, poule_va, poule_vb, directa_va, directa_vb, tipo)
  WITH ${internacionales(filtroTrozo(trozo, trozos), true)},
  ${ASALTOS},
  orientados AS (
    SELECT CASE WHEN pa < pb THEN id ELSE '~' || id END AS id, prueba, fase = 'POULE' AS poule,
      CASE WHEN pa < pb THEN pa ELSE pb END AS p1,
      CASE WHEN pa < pb THEN pb ELSE pa END AS p2,
      CASE WHEN pa < pb THEN ta ELSE tb END AS t1,
      CASE WHEN pa < pb THEN tb ELSE ta END AS t2
    FROM asaltos
    WHERE pa <> pb
  )
  SELECT o.p1, o.p2, x.fecha, o.prueba, x.arma, x.genero, x.categoria, x.modalidad, x.temporada,
    count(*), sum(o.t1 > o.t2), sum(o.t2 > o.t1), sum(o.t1), sum(o.t2), json_group_array(o.id),
    sum(o.poule AND o.t1 > o.t2), sum(o.poule AND o.t2 > o.t1), sum(NOT o.poule AND o.t1 > o.t2), sum(NOT o.poule AND o.t2 > o.t1),
    x.tipo
  FROM orientados o CROSS JOIN pruebas x ON x.id = o.prueba
  GROUP BY o.p1, o.p2, o.prueba`;
}

/**
 * Un trozo de las temporadas para `explorar_pais_tirador`: cada asalto
 * individual da dos filas, una por tirador frente al país del otro. Las
 * temporadas de un trozo no están en ningún otro, así que sus claves no
 * chocan con las de otro trozo.
 */
export function sqlTiradoresDeTrozo(trozo: number, trozos = TROZOS): string {
  return `INSERT INTO explorar_pais_tirador (${COLUMNAS_TIRADOR})
  WITH ${FUNDIDAS}, ${internacionales(`${filtroTrozo(trozo, trozos)} AND c.format <> 'EQUIPOS'`)},
  ${ASALTOS},
  lado(prueba, pais, rival, persona, mios, suyos, poule) AS (
    SELECT prueba, pa, pb, qa, ta, tb, fase = 'POULE' FROM asaltos WHERE pa <> pb AND qa IS NOT NULL
    UNION ALL
    SELECT prueba, pb, pa, qb, tb, ta, fase = 'POULE' FROM asaltos WHERE pa <> pb AND qb IS NOT NULL
  )
  SELECT l.pais, l.rival, x.temporada, coalesce(f.raiz, l.persona), x.genero, x.arma, x.categoria, x.modalidad,
    count(*), sum(l.mios > l.suyos), sum(l.suyos > l.mios), sum(l.mios), sum(l.suyos),
    sum(l.poule AND l.mios > l.suyos), sum(l.poule AND l.suyos > l.mios),
    sum(NOT l.poule AND l.mios > l.suyos), sum(NOT l.poule AND l.suyos > l.mios), max(x.fecha)
  FROM lado l CROSS JOIN pruebas x ON x.id = l.prueba
  LEFT JOIN fundidas f ON f.id = l.persona
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  ORDER BY 1, 2, 3, 4, 5, 6, 7, 8`;
}

/** Todas las temporadas (`temporada = ''`) de los países del tramo `[desde, hasta)`, sumando las filas por temporada. */
export function sqlTiradoresTodas(desde: string | null, hasta: string | null): string {
  const tramo = [desde ? ` AND pais >= '${desde}'` : '', hasta ? ` AND pais < '${hasta}'` : ''].join('');
  return `INSERT INTO explorar_pais_tirador (${COLUMNAS_TIRADOR})
  SELECT pais, rival, '', persona_id, genero, arma, categoria, modalidad,
    sum(asaltos), sum(victorias), sum(derrotas), sum(tf), sum(tc), sum(poule_v), sum(poule_d), sum(directa_v), sum(directa_d), max(ultima)
  FROM explorar_pais_tirador
  WHERE temporada <> ''${tramo}
  GROUP BY pais, rival, persona_id, genero, arma, categoria, modalidad
  ORDER BY pais, rival, persona_id, genero, arma, categoria, modalidad`;
}

/** `[desde, hasta)` de cada tramo de `TRAMOS_TIRADOR`; `null` es sin límite. */
export function tramosTirador(limites: readonly string[] = TRAMOS_TIRADOR): [string | null, string | null][] {
  const bordes = [null, ...limites, null];
  return bordes.slice(0, -1).map((d, i) => [d, bordes[i + 1]]);
}

export const SENTENCIAS_PAISES: readonly string[] = [
  'DELETE FROM explorar_pais_estado',
  'DELETE FROM explorar_pais_codigo',
  'DELETE FROM explorar_pais_resumen',
  'DELETE FROM explorar_pais_tiradores',
  'DELETE FROM explorar_pais_medalla',
  // Las tablas grandes se tiran y se crean en vez de vaciarlas: D1 cuenta cada
  // fila borrada como escrita. `explorar_pais_prueba` es una tabla con rowid y
  // sin clave: cada trozo sólo añade al final, y sus índices se crean al final
  // de una vez. Con la clave, cada trozo insertaba por todo el árbol y tardaba
  // más que el anterior (de 9 a 25 s).
  'DROP TABLE IF EXISTS explorar_pais_prueba',
  TABLA_PRUEBA,
  'DROP TABLE IF EXISTS explorar_pais_tirador',
  TABLA_TIRADOR,
  'DELETE FROM explorar_pais_rival',
  `INSERT INTO explorar_pais_codigo (codigo) VALUES ${CODIGOS_PAIS.map((c) => `('${c}')`).join(', ')}`,

  ...SENTENCIAS_TIPO_EDICION,
  ...Array.from({ length: TROZOS }, (_, i) => sqlPruebasDeTrozo(i)),
  'DROP TABLE IF EXISTS explorar_pais_tipo_edicion',
  ...INDICES_PRUEBA,
  ...Array.from({ length: TROZOS }, (_, i) => sqlTiradoresDeTrozo(i)),
  ...tramosTirador().map(([desde, hasta]) => sqlTiradoresTodas(desde, hasta)),

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
