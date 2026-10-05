import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { complementos } from './busqueda';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { SALTOS } from './personas';
import {
  consultaSugerencias, MAX_CANDIDATOS_SUGERENCIAS, MAX_CONSULTA_SUGERENCIAS,
  ordenarSugerencias, type CandidatoSugerencia,
} from './sugerencias-modelo';
import type { Arma } from './tipos';
import type { SugerenciaConResumen } from './tipos-busqueda';

const entrada = z.object({ q: z.string().max(MAX_CONSULTA_SUGERENCIAS) }).strict();

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
export function sqlCandidatosSugerencias(q: string) {
  const palabras = [...new Set(q.split(' ').filter((p) => p.length >= 3))]
    .sort((a, b) => b.length - a.length).slice(0, 4);
  if (palabras.length === 0) throw new Error('CONSULTA_SUGERENCIAS_NO_UTIL');
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
  return sql`WITH RECURSIVE candidatos AS (${sql.join(ramas, sql` UNION ALL `)}),
    ruta(persona, comparado, alias, id, destino, salto) AS (
      SELECT c.persona, substr(c.comparado, 1, 160), substr(c.alias, 1, 160), p.id, p.merged_into_person_id, 0
      FROM candidatos c JOIN sport_person p ON p.id = c.persona
      UNION ALL
      SELECT r.persona, r.comparado, r.alias, p.id, p.merged_into_person_id, r.salto + 1
      FROM ruta r JOIN sport_person p ON p.id = r.destino WHERE r.salto < ${SALTOS}
    )
    SELECT DISTINCT p.id, substr(p.display_name, 1, 160) AS nombre, r.alias,
      p.country_code AS pais, p.gender AS genero, p.birth_year AS "anioNacimiento",
      r.comparado AS "nombreComparado"
    FROM ruta r JOIN sport_person p ON p.id = r.id
    WHERE r.destino IS NULL LIMIT ${MAX_CANDIDATOS_SUGERENCIAS}`;
}

export type ResultadoSugerencias =
  | { estado: 'ok'; items: SugerenciaConResumen[] }
  | { estado: 'entrada_invalida' | 'no_disponible' };

export async function sugerirPersonas(ctx: ContextoExplorador, datos: unknown): Promise<ResultadoSugerencias> {
  await exigirPerfil(ctx);
  const parsed = entrada.safeParse(datos);
  if (!parsed.success) return { estado: 'entrada_invalida' };
  const q = consultaSugerencias(parsed.data.q);
  if (!q) return { estado: 'ok', items: [] };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const candidatos = filas<CandidatoSugerencia>(await ctx.db.execute(sqlCandidatosSugerencias(q)));
  const elegidas = ordenarSugerencias(q, candidatos);
  if (elegidas.length === 0) return { estado: 'ok', items: [] };
  // Una sola consulta acotada a las ocho elegidas, por grupo de fusión.
  const { conteos } = await complementos(ctx.db, elegidas.map((s) => s.id), []);
  const porId = new Map(conteos.map((c) => [c.id, c]));
  return {
    estado: 'ok',
    items: elegidas.map((s) => {
      const c = porId.get(s.id);
      return {
        ...s,
        resultados: c ? Number(c.resultados) : 0,
        armas: c?.armas ? (c.armas.split(',').sort() as Arma[]) : [],
      };
    }),
  };
}
