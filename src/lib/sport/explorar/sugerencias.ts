import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { SALTOS } from './personas';
import {
  consultaSugerencias, MAX_CONSULTA_SUGERENCIAS,
  ordenarSugerencias, type CandidatoSugerencia, type SugerenciaPersona,
} from './sugerencias-modelo';

const entrada = z.object({ q: z.string().max(MAX_CONSULTA_SUGERENCIAS) }).strict();

/**
 * Ocho intervalos como máximo, 12 filas por intervalo y tabla (192 en total).
 * name_normalized contiene palabras ordenadas: se prueban las palabras de la
 * consulta en cualquier orden como posibles inicios y un prefijo de dos
 * letras para erratas. Sólo se recuperan nombres/alias cuya primera palabra
 * normalizada coincide con un intervalo; no se recorre todo el catálogo.
 * No hay LIKE inicial, distancia SQL, ni recorrido del censo para sugerir.
 * Sólo se ordena por la columna indexada: ordenar homónimos por UUID antes
 * del LIMIT obligaría a leer todos los empates para formar un árbol temporal.
 */
export function sqlCandidatosSugerencias(q: string) {
  const palabras = [...new Set(q.split(' ').filter((p) => p.length >= 3))]
    .sort((a, b) => b.length - a.length).slice(0, 4);
  if (palabras.length === 0) throw new Error('CONSULTA_SUGERENCIAS_NO_UTIL');
  const prefijos = [...new Set(palabras.flatMap((p) => [p, p.slice(0, 2)]))];
  const ramas = prefijos.flatMap((prefijo) => [
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
  ]);
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
    WHERE r.destino IS NULL LIMIT 192`;
}

export type ResultadoSugerencias =
  | { estado: 'ok'; items: SugerenciaPersona[] }
  | { estado: 'entrada_invalida' | 'no_disponible' };

export async function sugerirPersonas(ctx: ContextoExplorador, datos: unknown): Promise<ResultadoSugerencias> {
  await exigirPerfil(ctx);
  const parsed = entrada.safeParse(datos);
  if (!parsed.success) return { estado: 'entrada_invalida' };
  const q = consultaSugerencias(parsed.data.q);
  if (!q) return { estado: 'ok', items: [] };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const candidatos = filas<CandidatoSugerencia>(await ctx.db.execute(sqlCandidatosSugerencias(q)));
  return { estado: 'ok', items: ordenarSugerencias(q, candidatos) };
}
