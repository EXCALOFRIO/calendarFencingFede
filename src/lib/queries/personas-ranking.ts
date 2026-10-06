import { sql } from 'drizzle-orm';
import type { Db } from '@/db';

/**
 * Persona deportiva de cada fila de las tablas de ranking, para su retrato y
 * el enlace a su ficha. Sólo enlaces `CONFIRMADO`.
 *
 * Se devuelve la persona del enlace tal cual, sin subir a la raíz de la
 * fusión: la ficha (`resolverPersona`) y la ruta de la foto ya siguen las
 * fusiones (y aplican el veto de menores), y leer `sport_person` para cada
 * una de las ~1.300 filas costaba más que todo lo demás de la pantalla.
 */

type Ejecutor = Pick<Db, 'execute'>;

function filasDe<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const rows = (r as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function aRegistro(filas: readonly { clave: string | number; persona: string | null }[]): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const f of filas) if (f.persona) salida[String(f.clave)] = f.persona;
  return salida;
}

/** `fieId` (addrId de la FIE) → persona. Lista JSON: un grupo FIE pasa de las 1.000 filas. */
export function sqlPersonasPorFieId(fieIds: readonly number[]) {
  return sql`
    SELECT v.value AS clave,
           (SELECT x.person_id FROM sport_external_id x
             WHERE x.scheme = 'fie_addr_id' AND x.value = v.value AND x.link_status = 'CONFIRMADO'
             ORDER BY x.linked_at DESC, x.person_id LIMIT 1) AS persona
    FROM json_each(${JSON.stringify(fieIds.map(String))}) v`;
}

export async function personasPorFieId(db: Ejecutor, fieIds: readonly number[]): Promise<Record<string, string>> {
  if (fieIds.length === 0) return {};
  try {
    return aRegistro(filasDe(await db.execute(sqlPersonasPorFieId(fieIds))));
  } catch {
    return {};
  }
}

/**
 * Persona de una fila de `official_ranking_entry` (alias `o`), por id estable:
 * la licencia RFEE publicada en la fila (vale su enlace más reciente) o, si no
 * la trae o no está enlazada, el id de Skermo en una publicación de la misma
 * temporada. Nunca por nombre.
 */
export const personaDeFilaOficial = sql`coalesce(
  (SELECT x.person_id FROM sport_external_id x
    WHERE x.scheme = 'rfee_license' AND x.value = o.source_license AND x.link_status = 'CONFIRMADO'
    ORDER BY x.scope_season DESC, x.person_id LIMIT 1),
  (SELECT e.person_id FROM sport_ranking_publication p
    CROSS JOIN sport_ranking_entry e ON e.publication_id = p.id AND e.source_ref = 'skermo:' || o.skermo_athlete_id
    WHERE p.source = 'skermo_ranking' AND p.season = o.season_label AND e.person_id IS NOT NULL
    ORDER BY p.published_on DESC LIMIT 1))`;

export function sqlPersonasOficiales(temporada: string) {
  return sql`
    SELECT o.id AS clave, ${personaDeFilaOficial} AS persona
    FROM official_ranking_entry o
    WHERE o.season_label = ${temporada}`;
}

export async function personasOficiales(db: Ejecutor, temporada: string | null): Promise<Record<string, string>> {
  if (!temporada) return {};
  try {
    return aRegistro(filasDe(await db.execute(sqlPersonasOficiales(temporada))));
  } catch {
    return {};
  }
}
