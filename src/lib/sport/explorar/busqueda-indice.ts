import { sql, type SQL } from 'drizzle-orm';
import { SALTOS, sqlGrupoDe } from './personas';

/**
 * Piezas SQL comunes a búsqueda y sugerencias con el índice de palabras
 * (migración 0004, `indice-sql.ts`). El índice sólo propone y ordena personas;
 * cada una se vuelve a comprobar con sus filas vivas, y las personas y alias
 * dados de alta tras la reconstrucción (rowid mayor que la marca) se buscan en
 * vivo, así que una sincronización o una ingesta diaria nunca esconden altas.
 * Lo que sí espera a la siguiente reconstrucción: un nombre o alias YA
 * indexado que cambie de texto, y una fusión o separación de personas.
 */

/**
 * CTE `palabras(w)`: las palabras de la consulta como UN parámetro JSON, para
 * comprobarlas en varias tablas sin multiplicar parámetros (D1 admite 100).
 */
export function ctePalabras(palabras: readonly string[]): SQL {
  return sql`palabras(w) AS MATERIALIZED (
      SELECT DISTINCT value FROM json_each(${JSON.stringify([...palabras])}))`;
}

/**
 * Cada palabra de `palabras` empieza el texto o una palabra del texto: la misma
 * regla que `LIKE 'w%' OR LIKE '% w%'` de la búsqueda sin índice.
 */
export function coincide(columna: SQL): SQL {
  return sql`NOT EXISTS (
      SELECT 1 FROM palabras pw
      WHERE NOT (${columna} LIKE pw.w || '%' OR ${columna} LIKE '% ' || pw.w || '%'))`;
}

/**
 * CTE `marcas`: rowid máximo indexado de personas y alias. Sin fila de estado
 * vale -1 y todo cuenta como alta posterior: se busca en vivo, más lento pero
 * nunca incompleto.
 */
export const CTE_MARCAS = sql.raw(`marcas(persona_rowid, alias_rowid) AS MATERIALIZED (
      SELECT coalesce((SELECT persona_rowid FROM explorar_indice_estado WHERE key = 'global'), -1),
             coalesce((SELECT alias_rowid FROM explorar_indice_estado WHERE key = 'global'), -1)
    )`);

/**
 * CTE `indexadas(n)`: personas del índice con todas las palabras como inicio de
 * alguna palabra de su nombre o de un alias de su grupo. Agrupar por `n` deja
 * la lista ordenada como la página. Requiere `palabras`.
 */
export const CTE_INDEXADAS = sql.raw(`indexadas(n) AS MATERIALIZED (
      SELECT t.n FROM palabras pw
      CROSS JOIN explorar_token t ON t.token >= pw.w AND t.token < pw.w || char(1114111)
      GROUP BY t.n
      HAVING count(DISTINCT pw.w) = (SELECT count(*) FROM palabras)
    )`);

/**
 * CTEs `delta_raices(id)`: personas que prevalecen con un nombre propio o un
 * alias dado de alta tras la marca que contiene todas las palabras (con
 * `coincide`, en vivo), subiendo por las fusiones como la búsqueda sin índice.
 * Requiere `palabras` y `marcas`.
 */
export function ctesDelta(): SQL {
  return sql`delta_alias(id) AS (
      SELECT a.person_id FROM sport_person_alias a
      WHERE a.rowid > (SELECT alias_rowid FROM marcas) AND ${coincide(sql`a.name_normalized`)}
    ),
    delta_subida(id, destino, salto) AS (
      SELECT sp.id, sp.merged_into_person_id, 0
      FROM delta_alias x CROSS JOIN sport_person sp ON sp.id = x.id
      UNION ALL
      SELECT sp.id, sp.merged_into_person_id, s.salto + 1
      FROM delta_subida s JOIN sport_person sp ON sp.id = s.destino
      WHERE s.destino IS NOT NULL AND s.salto < ${SALTOS}
    ),
    delta_raices(id) AS MATERIALIZED (
      SELECT p.id FROM sport_person p
      WHERE p.rowid > (SELECT persona_rowid FROM marcas)
        AND p.merged_into_person_id IS NULL AND ${coincide(sql`p.name_normalized`)}
      UNION
      SELECT id FROM delta_subida WHERE destino IS NULL
    )`;
}

/**
 * La persona `p` (fila viva de sport_person) sigue prevaleciendo y su nombre o
 * un alias vivo de su grupo contiene todas las palabras: la condición de la
 * búsqueda sin índice, evaluada sólo para las candidatas que se recorren.
 */
export function vigente(): SQL {
  return sql`p.merged_into_person_id IS NULL AND (${coincide(sql`p.name_normalized`)} OR EXISTS (
      SELECT 1 FROM sport_person_alias a
      WHERE a.person_id IN ${sqlGrupoDe(sql`p.id`)} AND ${coincide(sql`a.name_normalized`)}))`;
}

/**
 * CTEs del resumen de una página (`pagina(id, name_normalized, ...)`): las
 * mismas cuentas que `complementos` y `sqlTrayectorias`, con los resultados de
 * todo el grupo de fusión, en la misma sentencia que la búsqueda. Sólo las
 * `limite` primeras filas: la de más sólo indica que hay página siguiente.
 */
export function ctesResumenPagina(limite: number): SQL {
  return sql`,
    grupo_pagina(canonica, id, salto) AS (
      SELECT id, id, 0 FROM (SELECT id FROM pagina ORDER BY name_normalized, id LIMIT ${limite})
      UNION ALL
      SELECT g.canonica, mp.id, g.salto + 1
      FROM sport_person mp JOIN grupo_pagina g ON mp.merged_into_person_id = g.id
      WHERE g.salto < ${SALTOS}
    ),
    hechos_pagina AS MATERIALIZED (
      SELECT g.canonica AS canonica, r.position AS puesto, c.format AS formato, c.weapon AS arma,
             e.id AS edicion, e.name AS torneo,
             coalesce(r.occurred_on, c.competition_date, e.start_date) AS fecha
      FROM grupo_pagina g
      -- CROSS JOIN: sin él SQLite recorre todo sport_result y busca en el CTE.
      CROSS JOIN sport_result r ON r.person_id = g.id
      JOIN sport_competition c ON c.id = r.competition_id
      JOIN sport_edition e ON e.id = c.edition_id
    ),
    resumen_pagina AS (
      SELECT canonica, count(*) AS resultados, group_concat(DISTINCT arma) AS armas,
             min(CASE WHEN formato = 'INDIVIDUAL' THEN puesto END) AS mejor_puesto,
             count(*) FILTER (WHERE formato = 'INDIVIDUAL' AND puesto = 1) AS oros,
             count(*) FILTER (WHERE formato = 'INDIVIDUAL' AND puesto = 2) AS platas,
             count(*) FILTER (WHERE formato = 'INDIVIDUAL' AND puesto = 3) AS bronces
      FROM hechos_pagina GROUP BY canonica
    ),
    ultima_pagina AS (
      SELECT canonica, edicion, torneo, fecha FROM (
        SELECT canonica, edicion, torneo, fecha,
               row_number() OVER (
                 PARTITION BY canonica
                 ORDER BY coalesce(fecha, '0001-01-01') DESC, edicion DESC
               ) AS orden
        FROM hechos_pagina)
      WHERE orden = 1
    )`;
}

/** Columnas del resumen para `SELECT ... FROM pagina p ${UNIONES_RESUMEN}`. */
export const COLUMNAS_RESUMEN = sql.raw(`coalesce(rp.resultados, 0) AS resultados, rp.armas AS armas,
           rp.mejor_puesto AS "mejorPuesto", coalesce(rp.oros, 0) AS oros,
           coalesce(rp.platas, 0) AS platas, coalesce(rp.bronces, 0) AS bronces,
           up.edicion AS "ultimaEdicion", up.torneo AS "ultimoTorneo", up.fecha AS "ultimaFecha",
           (SELECT count(*) FROM sport_person h
            -- '+': sin él SQLite recorre todas las personas no fundidas por merged_idx.
            WHERE +h.merged_into_person_id IS NULL AND h.name_normalized = p.name_normalized
           ) AS "mismoNombre"`);

export const UNIONES_RESUMEN = sql.raw(`LEFT JOIN resumen_pagina rp ON rp.canonica = p.id
    LEFT JOIN ultima_pagina up ON up.canonica = p.id`);
