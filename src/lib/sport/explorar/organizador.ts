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

/** La segunda mitad de `plegadoConBordes`, sobre un texto ya pasado por `plegarSql`. */
export function bordesSql(plegado: SQL): SQL {
  let texto = plegado;
  for (const p of PUNTUACION) texto = sql`replace(${texto}, ${sql.raw(`'${p}'`)}, ' ')`;
  texto = sql`replace(replace(${texto}, 'С', 'c'), 'с', 'c')`;
  // Bordes de palabra: «% efc %» sólo coincide con la palabra entera.
  return sql`replace(replace(replace(' ' || ${texto} || ' ', '    ', ' '), '  ', ' '), '  ', ' ')`;
}

function plegadoConBordes(columna: SQL): SQL {
  return bordesSql(plegarSql(columna));
}

/**
 * El `\w*` de «champ\w*» en las formas que se publican. Un `%` de LIKE también
 * cruzaría espacios: «Championnats de qualification panaméricains» acababa en
 * continental sin serlo para `tipoPorNombre`.
 */
const FORMAS_CHAMP = ['champ', 'champs', 'champion', 'champions', 'championat', 'championats', 'championnat', 'championnats', 'championship', 'championships'];

/**
 * D1 rechaza árboles de expresión de más de 100 niveles, y SQLite encadena
 * `a OR b OR c…` como un árbol de tantos niveles como términos: la lista de
 * los campeonatos llega a 186. Agrupados por mitades quedan en ~8.
 */
export function oEquilibrado(terminos: readonly string[]): string {
  if (terminos.length === 1) return terminos[0];
  const mitad = Math.ceil(terminos.length / 2);
  return `(${oEquilibrado(terminos.slice(0, mitad))} OR ${oEquilibrado(terminos.slice(mitad))})`;
}

/** Los `WHEN … THEN` de `tipoPorNombre` sobre la columna `t`, ya plegada y con bordes. */
export function casosTipoPorNombre(): string {
  return FRASES_TIPO.map(([tipo, frases]) => {
    const literales = frases.flatMap((f) => (f.includes('champ%') ? FORMAS_CHAMP.map((c) => f.replace('champ%', c)) : [f]));
    return `WHEN ${oEquilibrado(literales.map((f) => `t LIKE '% ${f} %'`))} THEN '${tipo}'`;
  }).join('\n');
}

/**
 * `tipoPorNombre` en SQL: el tipo que da el nombre, o NULL. Sólo para SQLite
 * local (pruebas): en D1 pasa de 100 niveles de expresión. En D1, por etapas
 * como `sqlOrganizador` o `SENTENCIAS_TIPO_EDICION` de `pais-indice-sql.ts`.
 */
export function sqlTipoPorNombre(columna: SQL): SQL {
  return sql`(SELECT CASE ${sql.raw(casosTipoPorNombre())} END FROM (SELECT ${plegadoConBordes(columna)} AS t))`;
}

const TIPOS_EFC = sql.raw(`'CTO_EUROPA', 'CIRCUITO_EUROPEO'`);
const TIPOS_RFEE = sql.raw(`'CTO_ESPANA', 'TNR', 'LIGA_CLUBES', 'LIGA_MASTER', 'CRITERIUM', 'NACIONAL_OTRO'`);

/**
 * Condición SQL sobre la edición (`e`) con la misma regla que `organizadorDe`.
 * El tipo se calcula una vez por edición en una subconsulta sin correlación:
 * son unos pocos miles de filas, no una por resultado.
 *
 * Por etapas `MATERIALIZED`: escrito como una sola subconsulta, SQLite copiaba
 * el pliegue del nombre (~90 `replace` anidados) dentro de cada `LIKE` y D1
 * rechazaba la consulta (árbol de expresión de más de 100 niveles). Una CTE
 * materializada no se aplana, así que cada etapa es un árbol aparte.
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
  return sql`e.id IN (WITH
    org_plegado AS MATERIALIZED (SELECT x.id, x.source, x.country_code, ${plegarSql(sql`x.name`)} AS t FROM sport_edition x),
    org_bordes AS MATERIALIZED (SELECT id, source, country_code, ${bordesSql(sql`t`)} AS t FROM org_plegado),
    o AS MATERIALIZED (SELECT id, source, country_code, CASE ${sql.raw(casosTipoPorNombre())} END AS tipo FROM org_bordes)
    SELECT o.id FROM o WHERE ${condicion})`;
}
