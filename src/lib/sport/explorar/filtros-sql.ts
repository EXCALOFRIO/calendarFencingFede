import { sql, type SQL } from 'drizzle-orm';
import type { FiltrosPrueba } from './tipos';

/**
 * Fragmentos SQL compartidos. Los alias son fijos: `c` prueba, `e` edición,
 * `ev0` evento del calendario vinculado a la edición.
 */

/** Prueba, edición y evento del calendario de un hecho (`r` resultado o `b` asalto). */
export function unionesPrueba(hecho: 'r' | 'b'): SQL {
  return sql.raw(`JOIN sport_competition c ON c.id = ${hecho}.competition_id
    JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id`);
}

const LETRAS_CON = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const LETRAS_SIN = 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';

/** Texto en minúsculas, sin acentos y con la puntuación convertida en espacios. */
export function plegarSql(columna: SQL): SQL {
  // SQLite no incluye translate/regexp_replace ni plegado Unicode en lower.
  // El número de sustituciones es fijo, no depende del tamaño de la tabla.
  return sql`(WITH RECURSIVE plegado(texto, paso) AS (
    SELECT lower(${columna}), 1
    UNION ALL
    SELECT replace(texto, substr(${LETRAS_CON}, paso, 1), substr(${LETRAS_SIN}, paso, 1)), paso + 1
    FROM plegado WHERE paso <= ${LETRAS_CON.length}
  ) SELECT lower(replace(replace(replace(replace(texto, '-', ' '), ',', ' '), '.', ' '), '/', ' '))
    FROM plegado ORDER BY paso DESC LIMIT 1)`;
}

export function listaUuid(ids: readonly string[]): SQL {
  // Un grupo puede contener más de 100 miembros. JSON1 conserva todos sin
  // rebasar los parámetros D1 ni multiplicar una misma fila entre lotes.
  return sql`SELECT value FROM json_each(${JSON.stringify(ids)})`;
}

/**
 * Condiciones sobre UNA misma prueba/edición. Se usan siempre dentro de una
 * única fila de resultado o asalto, así que torneo, temporada, fechas, arma o
 * categoría se cumplen a la vez en el mismo hecho: otro año del mismo torneo
 * (otra edición) no satisface un filtro de temporada o fecha por haber
 * coincidido con otra prueba de la misma persona.
 *
 * `fecha` es la expresión de la fecha del hecho. Una fecha desconocida no
 * satisface un filtro de fechas.
 */
export function condicionesPrueba(f: FiltrosPrueba, fecha: SQL): SQL[] {
  const condiciones: SQL[] = [];
  if (f.temporada) condiciones.push(sql`c.season = ${f.temporada}`);
  if (f.edicionId) condiciones.push(sql`e.id = ${f.edicionId}`);
  if (f.torneo) {
    condiciones.push(sql`${plegarSql(sql`e.name`)} LIKE ${`%${f.torneo}%`}`);
  }
  if (f.desde) condiciones.push(sql`${fecha} >= ${f.desde}`);
  if (f.hasta) condiciones.push(sql`${fecha} <= ${f.hasta}`);
  if (f.arma) condiciones.push(sql`c.weapon = ${f.arma}`);
  if (f.genero) condiciones.push(sql`c.gender = ${f.genero}`);
  if (f.categoria) condiciones.push(sql`c.category = ${f.categoria}`);
  if (f.categoriaRaw) condiciones.push(sql`c.category_raw = ${f.categoriaRaw}`);
  if (f.formato) condiciones.push(sql`c.format = ${f.formato}`);
  if (f.ambito) {
    // Ámbito del evento vinculado; una edición FIE sin vínculo es internacional.
    // Sin ninguna de las dos pruebas el ámbito es desconocido y no coincide.
    condiciones.push(
      sql`coalesce(ev0.scope, CASE WHEN e.source = 'fie' THEN 'INTERNACIONAL' END) = ${f.ambito}`,
    );
  }
  return condiciones;
}

export function y(condiciones: readonly SQL[]): SQL {
  return condiciones.length > 0 ? sql.join([...condiciones], sql` AND `) : sql`TRUE`;
}

/** Tipo de torneo sólo si el calendario lo documenta. FIE_CIRCUITO/OTRO no distinguen tipo. */
export const TIPO_DOCUMENTADO = sql.raw(`(
  CASE
    WHEN ev0.circuit IS NOT NULL AND ev0.circuit NOT IN ('FIE_CIRCUITO', 'OTRO') THEN ev0.circuit
    WHEN evc.circuit IS NOT NULL AND evc.circuit NOT IN ('FIE_CIRCUITO', 'OTRO') THEN evc.circuit
  END
)`);

/** Unión con el evento canónico (el par de Skermo absorbido por la FIE o al revés). */
export const UNION_EVENTO_CANONICO = sql.raw(
  'LEFT JOIN event evc ON evc.id = ev0.canonical_event_id',
);

/** Fecha de un resultado para filtrar y ordenar; sin fecha usa la de la prueba y la edición. */
export const FECHA_RESULTADO = sql.raw('coalesce(r.occurred_on, c.competition_date, e.start_date)');
export const FECHA_ORDEN_RESULTADO = sql.raw(
  "coalesce(r.occurred_on, c.competition_date, e.start_date, '0001-01-01')",
);
