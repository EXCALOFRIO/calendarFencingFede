import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import { filas } from '@/lib/sport/explorar/contexto';
import { listEvents, type Scope } from './calendar';
import {
  FUENTES_IMPORTADAS,
  SEPARADOR_GANADOR,
  componerTramo,
  edicionesDeCruces,
  type EdicionDeEvento,
  type FilaCruce,
  type FilaPruebaImportada,
  type TramoPasado,
} from './calendario-pasado-modelo';

export type { EdicionDeEvento, PruebaPasada } from './calendario-pasado-modelo';

/**
 * Las columnas de una prueba de Explorar (alias `c`) con su edición (alias
 * `e`) y el resumen de resultados.
 *
 * El resumen son dos búsquedas por índice y no un `count(*)`: medido en la
 * copia de la base, contar los puestos de 330 pruebas de un trimestre de 2019
 * recorre decenas de miles de filas de `sport_result`, y aquí basta con saber
 * si hay alguna y quién ganó. Las dos van por
 * `sport_result_competition_position_idx (competition_id, position)`.
 */
const COLUMNAS = sql.raw(`
  c.id AS id, c.edition_id AS "edicionId", c.source AS fuente, c.season AS temporada,
  c.weapon AS arma,
  c.gender AS genero, c.category AS categoria,
  c.category_raw AS "categoriaRaw", c.format AS formato,
  c.competition_date AS fecha, c.source_url AS url,
  e.name AS edicion, e.start_date AS inicio, e.end_date AS fin, e.city AS ciudad,
  e.country_code AS pais, e.source_url AS "urlEdicion",
  EXISTS (SELECT 1 FROM sport_result r WHERE r.competition_id = c.id) AS "conResultados",
  (SELECT r.source_name || char(${SEPARADOR_GANADOR.charCodeAt(0)}) || coalesce(r.source_country_code, '')
     FROM sport_result r WHERE r.competition_id = c.id AND r.position = 1 LIMIT 1) AS ganador`);

const FUENTES_SQL = sql.raw(FUENTES_IMPORTADAS.map((f) => `'${f}'`).join(', '));

/**
 * Las pruebas de Explorar que SON estos torneos del calendario, por clave
 * exacta. Cuatro caminos, de más a menos oficial:
 *
 *  1. `sport_edition.event_id`, el vínculo guardado.
 *  2. `sport_competition.event_competition_id`, el vínculo guardado por prueba.
 *  3. La clave de la FIE: el evento `fie-2027-186` del calendario es la prueba
 *     `(fie, 2027, 186)` de Explorar, y tiene índice único. Vale para la
 *     tarjeta de la FIE y para la de Skermo que la absorbió.
 *  4. La de Skermo: la prueba `10158` del calendario de la RFEE es la
 *     `RFEE:10158` del ranking. Solo para `skermo_rfee` —los calendarios
 *     autonómicos reutilizan los mismos números— y comprobando arma, género,
 *     categoría y formato, con las dos temporadas en las que puede caer.
 *
 * Los dos primeros están vacíos hoy en la base (nadie ha rellenado esos
 * vínculos), pero son los oficiales y entran en cuanto existan.
 *
 * `t` añade a cada tarjeta los registros de la FIE que absorbió, para que lo
 * suyo suba a la tarjeta que se pinta.
 *
 * Los `CROSS JOIN` fijan el orden de las tablas a propósito: en SQLite es la
 * forma de que la lista de ids sea el bucle de fuera. Sin ellos, el planificador
 * empezaba la rama de Skermo recorriendo todas las pruebas de Skermo.
 */
async function crucesExactos(ids: string[]): Promise<FilaCruce[]> {
  if (ids.length === 0) return [];
  const lista = JSON.stringify(ids);
  const resultado = await db.execute(sql`
    WITH ids(id) AS (SELECT value FROM json_each(${lista})),
    t(id, tarjeta) AS (
      SELECT ids.id, ids.id FROM ids
      UNION ALL
      SELECT ev.id, ev.canonical_event_id
      FROM ids CROSS JOIN event ev ON ev.canonical_event_id = ids.id
    ),
    m(evento, prueba) AS (
      SELECT t.tarjeta, c.id
      FROM t CROSS JOIN sport_edition se ON se.event_id = t.id
      CROSS JOIN sport_competition c ON c.edition_id = se.id
      UNION
      SELECT t.tarjeta, c.id
      FROM t CROSS JOIN event_competition ec ON ec.event_id = t.id
      CROSS JOIN sport_competition c ON c.event_competition_id = ec.id
      UNION
      SELECT t.tarjeta, c.id
      FROM t CROSS JOIN event ev ON ev.id = t.id
      CROSS JOIN sport_competition c
        ON c.source = 'fie' AND c.season = substr(ev.source_id, 5, 4)
       AND c.competition_key = substr(ev.source_id, 10)
      WHERE ev.source = 'fie' AND ev.source_id LIKE 'fie-____-%'
      UNION
      SELECT t.tarjeta, c.id
      FROM t CROSS JOIN event ev ON ev.id = t.id AND ev.source = 'skermo_rfee'
      CROSS JOIN event_competition ec ON ec.event_id = ev.id AND ec.source_id IS NOT NULL
      CROSS JOIN sport_competition c
        ON c.source = 'skermo_rfee'
       AND c.season IN (
         (cast(substr(ev.start_date, 1, 4) AS integer) - 1) || '-' || substr(ev.start_date, 1, 4),
         substr(ev.start_date, 1, 4) || '-' || (cast(substr(ev.start_date, 1, 4) AS integer) + 1))
       AND c.competition_key = 'RFEE:' || ec.source_id
       AND c.weapon = ec.weapon AND c.gender = ec.gender
       AND c.category = ec.category AND c.format = ec.format
    )
    SELECT m.evento AS evento, ${COLUMNAS}
    FROM m CROSS JOIN sport_competition c ON c.id = m.prueba
    CROSS JOIN sport_edition e ON e.id = c.edition_id`);
  return filas<FilaCruce>(resultado);
}

/**
 * Todas las pruebas de Explorar de la FIE y la RFEE cuyas ediciones empiezan
 * en el tramo.
 *
 * El `+e.source` no es una errata: sin él, SQLite elige el índice único por
 * fuente (`sport_edition_key`) y recorre las 9.000 ediciones de la FIE para
 * quedarse con las de un trimestre. Apartándolo, entra por
 * `sport_edition_dates_idx` y lee solo el rango de fechas.
 */
async function pruebasDelTramo(desde: string, hasta: string): Promise<FilaPruebaImportada[]> {
  const resultado = await db.execute(sql`
    SELECT ${COLUMNAS}
    FROM sport_edition e CROSS JOIN sport_competition c ON c.edition_id = e.id
    WHERE e.start_date >= ${desde} AND e.start_date <= ${hasta}
      AND +e.source IN (${FUENTES_SQL})`);
  return filas<FilaPruebaImportada>(resultado);
}

/**
 * Las ediciones y pruebas de Explorar que SON este torneo del calendario, por
 * las mismas claves exactas que usa el calendario (vínculo guardado, clave de
 * la FIE, clave de Skermo y los registros que la tarjeta absorbió). No empareja
 * por parecido: lo que devuelve es el torneo, no uno que se le parece.
 *
 * Lista vacía si el torneo no tiene nada en Explorar o si la base no tiene las
 * tablas de Explorar. Dos viajes a la base, los dos por índice.
 */
export async function edicionesExplorarDeEvento(eventoId: string): Promise<EdicionDeEvento[]> {
  if (!eventoId || !(await esquemaDeportivo()).identidad) return [];
  return edicionesDeCruces(await crucesExactos([eventoId]));
}

/**
 * El calendario de un tramo ya pasado, con lo que Explorar sabe de él.
 *
 * Cinco viajes a la base contando los de `listEvents`, y en dos tandas: el
 * calendario y las pruebas del tramo van en paralelo; los cruces exactos
 * necesitan los ids del calendario y van después. Ninguno depende del tamaño
 * del histórico: todos entran por un índice acotado por fechas o por ids.
 *
 * `hasta` tiene que ser anterior a hoy: lo de hoy en adelante ya lo trae la
 * carga normal de la pantalla y no se duplica.
 */
export async function cargarTramoPasado({
  desde,
  hasta,
  hoy,
  scope,
}: {
  desde: string;
  hasta: string;
  hoy: string;
  scope: Scope[];
}): Promise<TramoPasado> {
  const disponible = (await esquemaDeportivo()).identidad;
  const [calendario, importadas] = await Promise.all([
    listEvents({
      scope,
      includePast: true,
      from: desde,
      to: hasta,
      endBefore: hoy,
      limit: 400,
    }),
    disponible ? pruebasDelTramo(desde, hasta) : Promise.resolve([]),
  ]);
  const cruces = disponible ? await crucesExactos(calendario.map((e) => e.id)) : [];
  return componerTramo({ desde, hasta, calendario, cruces, importadas, disponible });
}
