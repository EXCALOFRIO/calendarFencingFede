import { sql, type SQL } from 'drizzle-orm';
import { plegarSql } from './filtros-sql';
import { FRASES_TIPO } from './tipo-competicion';
import type { ClasificacionCompeticion } from './tipos-social';

/**
 * Quién organiza una prueba, para la insignia y el filtro «Organizador».
 *
 * Manda el tipo de competición y no la fuente de la que se leyó: un
 * Campeonato de Europa es de la EFC aunque sus resultados lleguen por la FIE,
 * igual que en el calendario (`organismoDe`, donde `CTO_EUROPA` ya es EFC).
 */

export const ORGANIZADORES = ['FIE', 'EFC', 'RFEE'] as const;
export type OrganizadorFiltro = (typeof ORGANIZADORES)[number];
export type Organizador = OrganizadorFiltro | 'AUT' | 'OTRO';

export const ETIQUETA_ORGANIZADOR: Record<Organizador, string> = {
  FIE: 'FIE',
  EFC: 'EFC',
  RFEE: 'RFEE',
  AUT: 'Autonómica',
  OTRO: 'Otro organizador',
};

export const NOMBRE_ORGANIZADOR: Record<Organizador, string> = {
  FIE: 'Federación Internacional de Esgrima',
  EFC: 'Confederación Europea de Esgrima',
  RFEE: 'Real Federación Española de Esgrima',
  AUT: 'Federación autonómica',
  OTRO: 'Organizador sin identificar',
};

export function organizadorDe(
  c: Pick<ClasificacionCompeticion, 'tipo' | 'ambito'>,
  fuente: string,
): Organizador {
  if (c.tipo === 'CTO_EUROPA' || c.tipo === 'CIRCUITO_EUROPEO' || fuente === 'efc') return 'EFC';
  if (fuente === 'fie') return 'FIE';
  if (c.tipo === 'AUTONOMICO') return 'AUT';
  return c.ambito === 'nacional' ? 'RFEE' : 'OTRO';
}

/**
 * La regla, escrita una vez para la insignia y otra para el filtro, que tienen
 * que coincidir siempre (la insignia de la página de la prueba es
 * `organizadorDe(clasificarCompeticion({ nombre, fuente, pais }))`):
 *
 *  · EFC: la fuente es la EFC, o el nombre de la edición es de un Campeonato
 *    de Europa o del circuito europeo, venga de donde venga (Engarde aloja
 *    pruebas del circuito cadete y sub-23, y la FIE los Europeos).
 *  · FIE: la fuente es la FIE y no es lo anterior.
 *  · AUT: el nombre es de un autonómico, o la fuente es Skermo regional.
 *  · RFEE: lo demás que es nacional: un nombre nacional (TNR, Cto. de España,
 *    Liga, Criterium, Liga Máster) o, sin tipo por el nombre, sede en España o
 *    sin publicar.
 *
 * Manda el nombre, no el calendario: no se mira el evento vinculado, igual que
 * la insignia. Con un nombre mixto gana la primera regla de `REGLAS` que
 * coincide, y el circuito europeo va antes que el TNR: «TNR and EFC U23 Foil
 * Open Sabadell» es la prueba abierta de la EFC que la RFEE puntúa como TNR, y
 * es de la EFC.
 */

/** Lo que hace `plegarNombre` y `plegarSql` no: el resto de la puntuación y los espacios dobles. */
const PUNTUACION = ['"', "''", '(', ')', ':', ';', '_', '&', '+', '!', '?', '«', '»', '·', '#', '*', '[', ']', '’', '‘', '´', '`', '|', '–', '—', '“', '”'];

function plegadoConBordes(columna: SQL): SQL {
  let texto = plegarSql(columna);
  for (const p of PUNTUACION) texto = sql`replace(${texto}, ${sql.raw(`'${p}'`)}, ' ')`;
  texto = sql`replace(replace(${texto}, 'С', 'c'), 'с', 'c')`;
  // Bordes de palabra: «% efc %» sólo coincide con la palabra entera.
  return sql`replace(replace(replace(' ' || ${texto} || ' ', '    ', ' '), '  ', ' '), '  ', ' ')`;
}

/**
 * El `\w*` de «champ\w*» en las formas que se publican. Un `%` de LIKE también
 * cruzaría espacios: «Championnats de qualification panaméricains» acababa en
 * continental sin serlo para `tipoPorNombre`.
 */
const FORMAS_CHAMP = ['champ', 'champs', 'champion', 'champions', 'championat', 'championats', 'championnat', 'championnats', 'championship', 'championships'];

/** `tipoPorNombre` en SQL: el tipo que da el nombre, o NULL. */
export function sqlTipoPorNombre(columna: SQL): SQL {
  const casos = FRASES_TIPO.map(([tipo, frases]) => {
    const literales = frases.flatMap((f) => (f.includes('champ%') ? FORMAS_CHAMP.map((c) => f.replace('champ%', c)) : [f]));
    return `WHEN ${literales.map((f) => `t LIKE '% ${f} %'`).join(' OR ')} THEN '${tipo}'`;
  }).join('\n');
  return sql`(SELECT CASE ${sql.raw(casos)} END FROM (SELECT ${plegadoConBordes(columna)} AS t))`;
}

const TIPOS_EFC = sql.raw(`'CTO_EUROPA', 'CIRCUITO_EUROPEO'`);
const TIPOS_RFEE = sql.raw(`'CTO_ESPANA', 'TNR', 'LIGA_CLUBES', 'LIGA_MASTER', 'CRITERIUM', 'NACIONAL_OTRO'`);

/**
 * Condición SQL sobre la edición (`e`) con la misma regla que `organizadorDe`.
 * El tipo se calcula una vez por edición en una subconsulta sin correlación:
 * son unos pocos miles de filas, no una por resultado.
 */
export function sqlOrganizador(organizador: OrganizadorFiltro): SQL {
  const efc = sql`(o.source = 'efc' OR coalesce(o.tipo, '') IN (${TIPOS_EFC}))`;
  const condicion =
    organizador === 'EFC'
      ? efc
      : organizador === 'FIE'
        ? sql`(o.source = 'fie' AND NOT ${efc})`
        : sql`(o.source NOT IN ('efc', 'fie') AND (o.tipo IN (${TIPOS_RFEE}) OR (o.tipo IS NULL
            AND o.source <> 'skermo_regional' AND coalesce(nullif(o.country_code, ''), 'ESP') = 'ESP')))`;
  return sql`e.id IN (SELECT o.id FROM (SELECT x.id, x.source, x.country_code,
    ${sqlTipoPorNombre(sql`x.name`)} AS tipo FROM sport_edition x) o WHERE ${condicion})`;
}
