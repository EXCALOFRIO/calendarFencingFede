import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { anioNacimientoPublico } from './anio-publico';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { CTE_MARCAS, ctePalabras, ctesDelta } from './busqueda-indice';
import { listaUuid } from './filtros-sql';
import { MAX_LETRAS_VARIANTE } from './indice-sql';
import { SALTOS } from './personas';
import {
  consultaSugerencias, MAX_CANDIDATOS_SUGERENCIAS, MAX_CONSULTA_SUGERENCIAS, MAX_SUGERENCIAS,
  MAX_SUGERENCIAS_SOCIAL, ordenarSugerencias, type CandidatoSugerencia,
} from './sugerencias-modelo';
import type { Arma } from './tipos';
import type { SugerenciaConResumen } from './tipos-busqueda';

const entrada = z.object({
  q: z.string().max(MAX_CONSULTA_SUGERENCIAS),
  limite: z.number().int().min(1).max(MAX_SUGERENCIAS_SOCIAL).optional(),
}).strict();

/**
 * Ocho intervalos como máximo, 12 filas por intervalo y tabla, más dos ramas
 * de «todas las palabras» de 12 filas (216 en total).
 * name_normalized contiene palabras ordenadas: se prueban las palabras de la
 * consulta en cualquier orden como posibles inicios y un prefijo de dos
 * letras para erratas. Esos intervalos sólo encuentran nombres cuya PRIMERA
 * palabra ordenada coincide, así que «juan perez» no llegaría a «garcia juan
 * perez»: la rama de todas las palabras exige que cada palabra escrita (de
 * tres letras o más) empiece una palabra del nombre o del alias, y se corta
 * en 12 filas. No hay distancia SQL. Sólo se ordena por la columna indexada:
 * ordenar homónimos por UUID antes del LIMIT obligaría a leer todos los
 * empates para formar un árbol temporal.
 */
export function sqlCandidatosSugerencias(q: string, profileId?: string) {
  const palabras = [...new Set(q.split(' ').filter((p) => p.length >= 3))]
    .sort((a, b) => b.length - a.length).slice(0, 4);
  if (palabras.length === 0) throw new Error('CONSULTA_SUGERENCIAS_NO_UTIL');
  const seguida = profileId ? sql`p.id IN seguidas` : sql`0`;
  const prefijos = [...new Set(palabras.flatMap((p) => [p, p.slice(0, 2)]))];
  const todas = (columna: SQL) => sql.join(
    palabras.map((w) => sql`(${columna} LIKE ${`${w}%`} OR ${columna} LIKE ${`% ${w}%`})`),
    sql` AND `,
  );
  const interiores = [
    sql`SELECT * FROM (
      SELECT p.id AS persona, p.display_name AS comparado, NULL AS alias
      FROM sport_person p
      WHERE ${todas(sql`p.name_normalized`)}
      LIMIT 12)`,
    sql`SELECT * FROM (
      SELECT a.person_id AS persona, a.name_original AS comparado, a.name_original AS alias
      FROM sport_person_alias a
      WHERE ${todas(sql`a.name_normalized`)}
      LIMIT 12)`,
  ];
  const ramas = [...interiores, ...prefijos.flatMap((prefijo) => [
    sql`SELECT * FROM (
      SELECT p.id AS persona, p.display_name AS comparado, NULL AS alias
      FROM sport_person p
      WHERE p.name_normalized >= ${prefijo} AND p.name_normalized < ${`${prefijo}\uffff`}
      ORDER BY p.name_normalized LIMIT 12)`,
    sql`SELECT * FROM (
      SELECT a.person_id AS persona, a.name_original AS comparado, a.name_original AS alias
      FROM sport_person_alias a
      WHERE a.name_normalized >= ${prefijo} AND a.name_normalized < ${`${prefijo}\uffff`}
      ORDER BY a.name_normalized LIMIT 12)`,
  ])];
  return sql`WITH RECURSIVE candidatos AS (${unionAcotada(ramas)}),${profileId ? sql`
    ${cteSeguidas(profileId)},` : sql``}
    ruta(persona, comparado, alias, id, destino, salto) AS (
      SELECT c.persona, substr(c.comparado, 1, 160), substr(c.alias, 1, 160), p.id, p.merged_into_person_id, 0
      FROM candidatos c JOIN sport_person p ON p.id = c.persona
      UNION ALL
      SELECT r.persona, r.comparado, r.alias, p.id, p.merged_into_person_id, r.salto + 1
      FROM ruta r JOIN sport_person p ON p.id = r.destino WHERE r.salto < ${SALTOS}
    )
    SELECT DISTINCT p.id, substr(p.display_name, 1, 160) AS nombre, r.alias,
      p.country_code AS pais, p.gender AS genero, p.birth_year AS "anioNacimiento",
      r.comparado AS "nombreComparado", ${seguida} AS seguida
    FROM ruta r JOIN sport_person p ON p.id = r.id
    WHERE r.destino IS NULL LIMIT ${MAX_CANDIDATOS_SUGERENCIAS}`;
}

/**
 * D1 rechaza un SELECT compuesto de más de cinco términos («too many terms in
 * compound SELECT»), pero el límite se cuenta por cadena: anidar grupos de
 * cuatro en subconsultas mantiene cada cadena por debajo sin cambiar filas,
 * parámetros ni planes.
 */
const TERMINOS_POR_CADENA = 4;

export function unionAcotada(ramas: readonly SQL[]): SQL {
  if (ramas.length <= TERMINOS_POR_CADENA) return sql.join([...ramas], sql` UNION ALL `);
  const grupos: SQL[] = [];
  for (let i = 0; i < ramas.length; i += TERMINOS_POR_CADENA) {
    grupos.push(sql`SELECT * FROM (${sql.join(ramas.slice(i, i + TERMINOS_POR_CADENA), sql` UNION ALL `)})`);
  }
  return unionAcotada(grupos);
}

/** Personas del índice que se puntúan; las altas posteriores se añaden aparte. */
export const MAX_RAICES_INDEXADAS = 48;
const MAX_RAICES_DELTA = 12;

/**
 * Claves del vecindario de un borrado (la palabra y cada borrado de una letra)
 * con la misma longitud admitida que `explorar_variante`: dos palabras a una
 * errata (sustitución, inserción, borrado o trasposición) comparten clave.
 */
export function clavesVariante(palabra: string): string[] {
  const letras = Array.from(palabra);
  const claves = new Set<string>();
  if (letras.length >= 4 && letras.length <= MAX_LETRAS_VARIANTE) claves.add(palabra);
  if (letras.length >= 5 && letras.length <= MAX_LETRAS_VARIANTE + 1) {
    for (let i = 0; i < letras.length; i++) claves.add([...letras.slice(0, i), ...letras.slice(i + 1)].join(''));
  }
  return [...claves];
}

/**
 * CTE `seguidas(id)`: personas que sigue la cuenta, como la que prevalece. Una
 * lectura por la clave primaria (profile_id, person_id) de sport_favorite.
 */
function cteSeguidas(profileId: string): SQL {
  return sql`seguidas(id) AS MATERIALIZED (
      SELECT DISTINCT coalesce(sp.merged_into_person_id, sp.id)
      FROM sport_favorite f CROSS JOIN sport_person sp ON sp.id = f.person_id
      WHERE f.profile_id = ${profileId})`;
}

/**
 * Candidatas con el índice de palabras (migración 0004) en UNA sentencia: cada
 * palabra de la consulta (tres letras o más) acierta un token por prefijo
 * (directa) o, si tiene una errata, por una clave compartida en
 * `explorar_variante`. Se eligen las personas con más palabras acertadas, luego
 * con más aciertos directos, luego las que sigue la cuenta y, a igualdad, las
 * más populares (el peso del índice): así «alejandro» no pierde Alejandros
 * frente a Alejandras igual de activas. Se añaden las altas posteriores a la
 * reconstrucción que contienen todas las palabras (en vivo). El texto que se
 * puntúa es el VIVO: nombre de la persona y alias de todo su grupo, y una
 * persona fundida tras la reconstrucción se descarta. Ningún SELECT compuesto
 * pasa de dos términos.
 */
export function sqlCandidatosIndexados(q: string, profileId?: string): SQL {
  const palabras = [...new Set(q.split(' ').filter((p) => p.length >= 3))]
    .sort((a, b) => b.length - a.length).slice(0, 4);
  if (palabras.length === 0) throw new Error('CONSULTA_SUGERENCIAS_NO_UTIL');
  const claves = palabras.flatMap((w) => clavesVariante(w).map((c) => [w, c]));
  const seguida = (columna: SQL) => (profileId ? sql`(${columna} IN seguidas)` : sql`0`);
  return sql`WITH RECURSIVE ${ctePalabras(palabras)},
    ${CTE_MARCAS},${profileId ? sql`
    ${cteSeguidas(profileId)},` : sql``}
    variantes(w, palabra) AS MATERIALIZED (
      SELECT DISTINCT json_extract(j.value, '$[0]'), v.palabra
      FROM json_each(${JSON.stringify(claves)}) j
      CROSS JOIN explorar_variante v ON v.clave = json_extract(j.value, '$[1]')
    ),
    aciertos(n, w, directa) AS (
      SELECT t.n, pw.w, 1 FROM palabras pw
      CROSS JOIN explorar_token t ON t.token >= pw.w AND t.token < pw.w || char(1114111)
      UNION
      SELECT t.n, v.w, 0 FROM variantes v CROSS JOIN explorar_token t ON t.token = v.palabra
    ),
    elegidas(id, peso, seguida) AS MATERIALIZED (
      SELECT ep.id, ep.peso, ${seguida(sql`ep.id`)}
      FROM (
        SELECT n, count(DISTINCT w) AS aciertos, count(DISTINCT CASE WHEN directa THEN w END) AS directas
        FROM aciertos GROUP BY n
      ) x
      JOIN explorar_persona ep ON ep.n = x.n
      ORDER BY x.aciertos DESC, x.directas DESC, 3 DESC, ep.peso DESC, ep.n
      LIMIT ${MAX_RAICES_INDEXADAS}
    ),
    ${ctesDelta()},
    raices(id, peso, seguida) AS MATERIALIZED (
      SELECT id, peso, seguida FROM elegidas
      UNION
      SELECT id, 0, ${seguida(sql`id`)} FROM (SELECT id FROM delta_raices LIMIT ${MAX_RAICES_DELTA})
    ),
    vivas AS MATERIALIZED (
      SELECT p.id, substr(p.display_name, 1, 160) AS nombre, p.country_code AS pais,
             p.gender AS genero, p.birth_year AS "anioNacimiento", p.name_normalized AS clave,
             max(r.peso) AS peso, max(r.seguida) AS seguida
      -- CROSS JOIN y '+': sin ellos SQLite recorre todas las personas no fundidas.
      FROM raices r CROSS JOIN sport_person p ON p.id = r.id
      WHERE +p.merged_into_person_id IS NULL
      GROUP BY p.id
    ),
    grupo_vivas(canonica, id, salto) AS (
      SELECT id, id, 0 FROM vivas
      UNION ALL
      SELECT g.canonica, mp.id, g.salto + 1
      FROM grupo_vivas g JOIN sport_person mp ON mp.merged_into_person_id = g.id
      WHERE g.salto < ${SALTOS}
    )
    SELECT v.id, v.nombre, NULL AS alias, v.pais, v.genero, v."anioNacimiento",
           v.nombre AS "nombreComparado", v.peso, v.seguida
    FROM vivas v
    UNION ALL
    SELECT v.id, v.nombre, substr(a.name_original, 1, 160), v.pais, v.genero, v."anioNacimiento",
           substr(a.name_original, 1, 160), v.peso, v.seguida
    -- CROSS JOIN: sin él SQLite recorre todos los alias y busca en los CTE.
    FROM grupo_vivas g
    CROSS JOIN vivas v ON v.id = g.canonica
    CROSS JOIN sport_person_alias a ON a.person_id = g.id
    -- Un alias con el mismo texto normalizado que el nombre no puntúa distinto.
    WHERE a.name_normalized <> v.clave
    LIMIT ${MAX_CANDIDATOS_SUGERENCIAS}`;
}

export type ResultadoSugerencias =
  | { estado: 'ok'; items: SugerenciaConResumen[] }
  | { estado: 'entrada_invalida' | 'no_disponible' };

type FilaResumenSugerencia = {
  id: string;
  resultados: number;
  armas: string | null;
  ultimaFecha: string | null;
  seguida: number;
};

/**
 * Resumen de las elegidas (veinte como mucho) con los resultados de todo su
 * grupo de fusión: cuántos, armas, fecha del más reciente y si la cuenta sigue
 * a alguna persona del grupo. Una fecha más de un mes en el futuro es un dato
 * erróneo y no cuenta como «última».
 */
export function sqlResumenSugerencias(ids: readonly string[], profileId: string): SQL {
  return sql`
    WITH RECURSIVE miembros_grupo(canonica, id, salto) AS (
      SELECT id, id, 0 FROM sport_person WHERE id IN (${listaUuid(ids)})
      UNION ALL
      SELECT mg.canonica, mp.id, mg.salto + 1
      FROM sport_person mp JOIN miembros_grupo mg ON mp.merged_into_person_id = mg.id
      WHERE mg.salto < ${SALTOS}
    )
    SELECT g.canonica AS id, count(r.id) AS resultados,
           group_concat(DISTINCT c.weapon) AS armas,
           max(CASE WHEN r.occurred_on <= date('now', '+1 month') THEN r.occurred_on END) AS "ultimaFecha",
           EXISTS (
             SELECT 1 FROM sport_favorite f
             WHERE f.profile_id = ${profileId}
               AND f.person_id IN (SELECT m.id FROM miembros_grupo m WHERE m.canonica = g.canonica)
           ) AS seguida
    FROM miembros_grupo g
    -- LEFT JOIN desde el grupo: también quien no tiene resultados, sin recorrer sport_result.
    LEFT JOIN sport_result r ON r.person_id = g.id
    LEFT JOIN sport_competition c ON c.id = r.competition_id
    GROUP BY g.canonica`;
}

export async function sugerirPersonas(ctx: ContextoExplorador, datos: unknown): Promise<ResultadoSugerencias> {
  const perfil = await exigirPerfil(ctx);
  const parsed = entrada.safeParse(datos);
  if (!parsed.success) return { estado: 'entrada_invalida' };
  const q = consultaSugerencias(parsed.data.q);
  if (!q) return { estado: 'ok', items: [] };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const indexada = ctx.indiceExplorar ? await ctx.indiceExplorar() : false;
  const candidatos = filas<CandidatoSugerencia>(await ctx.db.execute(
    indexada ? sqlCandidatosIndexados(q, perfil.profileId) : sqlCandidatosSugerencias(q, perfil.profileId),
  ));
  const elegidas = ordenarSugerencias(q, candidatos, parsed.data.limite ?? MAX_SUGERENCIAS);
  if (elegidas.length === 0) return { estado: 'ok', items: [] };
  // Una sola consulta acotada a las elegidas, por grupo de fusión.
  const resumen = filas<FilaResumenSugerencia>(
    await ctx.db.execute(sqlResumenSugerencias(elegidas.map((s) => s.id), perfil.profileId)),
  );
  const porId = new Map(resumen.map((c) => [c.id, c]));
  const hoy = ctx.hoy();
  return {
    estado: 'ok',
    items: elegidas.map((s) => {
      const c = porId.get(s.id);
      return {
        ...s,
        anioNacimiento: anioNacimientoPublico(s.anioNacimiento, hoy),
        resultados: c ? Number(c.resultados) : 0,
        armas: c?.armas ? (c.armas.split(',').sort() as Arma[]) : [],
        ultimaFecha: typeof c?.ultimaFecha === 'string' ? c.ultimaFecha.slice(0, 10) : null,
        seguida: Boolean(Number(c?.seguida ?? 0)),
      };
    }),
  };
}
