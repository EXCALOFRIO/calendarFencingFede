import { sql, type SQL } from 'drizzle-orm';
import { filas, type ContextoExplorador } from './contexto';
import type { Genero } from './tipos';
import { listaUuid } from './filtros-sql';

/** Cuántas fusiones A→B→C se siguen antes de dar la cadena por rota. */
export const SALTOS = 3;

/**
 * Subconsulta con los IDs de la persona que prevalece y las fundidas en ella
 * (misma profundidad que `resolverPersona`), para `x.person_id IN ${...}`.
 * Hace descubribles por alias y hechos retenidos en una persona fundida sin
 * añadir filas: se usa dentro de EXISTS, nunca como JOIN.
 */
export function sqlGrupoDe(canonica: SQL): SQL {
  return sql`(WITH RECURSIVE miembros_grupo(id, salto) AS (
      SELECT ${canonica}, 0
      UNION ALL
      SELECT mp.id, mg.salto + 1
      FROM sport_person mp JOIN miembros_grupo mg ON mp.merged_into_person_id = mg.id
      WHERE mg.salto < ${SALTOS}
    ) SELECT id FROM miembros_grupo)`;
}

export type PersonaResuelta = {
  /** Persona que prevalece tras seguir las fusiones. */
  canonicaId: string;
  /** La canónica y las personas fundidas en ella: los hechos pueden colgar de cualquiera. */
  ids: string[];
};

/**
 * Una fusión es reversible y apunta a la persona que prevalece. Los hechos
 * (puestos, asaltos) conservan el ID con el que se guardaron, así que se leen
 * por el grupo completo. Una cadena más larga que `SALTOS` no se resuelve: es
 * «no encontrada», no una elección arbitraria.
 */
export async function resolverPersona(
  db: ContextoExplorador['db'],
  personaId: string,
): Promise<PersonaResuelta | null> {
  const [canonica] = filas<{ id: string }>(
    await db.execute(sql`
      WITH RECURSIVE cadena AS (
        SELECT id, merged_into_person_id, 0 AS salto
        FROM sport_person WHERE id = ${personaId}
        UNION ALL
        SELECT p.id, p.merged_into_person_id, c.salto + 1
        FROM sport_person p JOIN cadena c ON p.id = c.merged_into_person_id
        WHERE c.salto < ${SALTOS}
      )
      SELECT id AS id FROM cadena WHERE merged_into_person_id IS NULL LIMIT 1`),
  );
  if (!canonica) return null;

  const grupo = filas<{ id: string }>(
    await db.execute(sql`
      WITH RECURSIVE grupo AS (
        SELECT id, 0 AS salto FROM sport_person WHERE id = ${canonica.id}
        UNION ALL
        SELECT p.id, g.salto + 1
        FROM sport_person p JOIN grupo g ON p.merged_into_person_id = g.id
        WHERE g.salto < ${SALTOS}
      )
      SELECT DISTINCT id AS id FROM grupo`),
  );
  const ids = [...new Set([canonica.id, ...grupo.map((g) => g.id)])];
  return { canonicaId: canonica.id, ids };
}

export type CabeceraPersona = {
  id: string;
  nombre: string;
  pais: string | null;
  genero: Genero | null;
  anioNacimiento: number | null;
};

/** Sólo las columnas deportivas públicas de la persona: nada de ficha ni cuenta. */
export async function leerCabeceras(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<Map<string, CabeceraPersona>> {
  const mapa = new Map<string, CabeceraPersona>();
  if (ids.length === 0) return mapa;
  const lista = listaUuid(ids);
  const rows = filas<{
    id: string;
    nombre: string;
    pais: string | null;
    genero: Genero | null;
    anioNacimiento: number | null;
  }>(
    await db.execute(sql`
      SELECT id AS id, display_name AS nombre, country_code AS pais,
             gender AS genero, birth_year AS "anioNacimiento"
      FROM sport_person WHERE id IN (${lista})`),
  );
  for (const r of rows) {
    mapa.set(r.id, {
      id: r.id,
      nombre: r.nombre,
      pais: r.pais,
      genero: r.genero,
      anioNacimiento: r.anioNacimiento === null ? null : Number(r.anioNacimiento),
    });
  }
  return mapa;
}
