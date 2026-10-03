import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db';
import { AHORA_SQL } from '@/lib/sqlite';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import type { DepsGuardConfirmacion, IdExternoCandidato, PersonaNuevaConId } from './id-guard';

/** D1 batch es una unidad serializada. Cada escritura vuelve a comprobar el
 * choque dentro de esa unidad: no hay cerrojo PG ni comprobación TOCTOU. */
function canonica(id: SQL): SQL {
  return sql`(WITH RECURSIVE cadena(id, destino, salto) AS (
    SELECT p.id, p.merged_into_person_id, 0 FROM sport_person p WHERE p.id = ${id}
    UNION ALL
    SELECT p.id, p.merged_into_person_id, c.salto + 1
    FROM sport_person p JOIN cadena c ON p.id = c.destino WHERE c.salto < 3
  ) SELECT id FROM cadena WHERE destino IS NULL LIMIT 1)`;
}

function personaCanonica(c: IdExternoCandidato): SQL {
  // Una nueva persona aún no está en el catálogo. Una cadena existente rota
  // devuelve NULL y no puede confirmarse como si fuera una identidad nueva.
  return sql`CASE WHEN EXISTS (SELECT 1 FROM sport_person WHERE id = ${c.personId})
    THEN ${canonica(sql`${c.personId}`)} ELSE ${c.personId} END`;
}

export function sqlHayChoque(c: IdExternoCandidato): SQL {
  return sql`EXISTS (
    SELECT 1 FROM sport_external_id e
    WHERE e.link_status = 'CONFIRMADO'
      AND e.scheme = ${c.scheme} AND e.value = ${c.value.trim()}
      AND e.scope_source = ${c.scopeSource}
      AND (e.scope_federation = '' OR ${c.scopeFederation} = '' OR e.scope_federation = ${c.scopeFederation})
      AND (e.scope_season = '' OR ${c.scopeSeason} = '' OR e.scope_season = ${c.scopeSeason})
      AND (e.scope_weapon = '' OR ${c.scopeWeapon} = '' OR e.scope_weapon = ${c.scopeWeapon})
      AND e.valid_from <= coalesce(${c.validTo}, '9999-12-31')
      AND ${c.validFrom} <= coalesce(e.valid_to, '9999-12-31')
      AND coalesce(${canonica(sql`e.person_id`)}, e.person_id) <> ${personaCanonica(c)}
  )`;
}

function propia(c: IdExternoCandidato): SQL {
  return sql`e.link_status = 'CONFIRMADO'
    AND e.scheme = ${c.scheme} AND e.value = ${c.value.trim()}
    AND e.scope_source = ${c.scopeSource} AND e.scope_federation = ${c.scopeFederation}
    AND e.scope_season = ${c.scopeSeason} AND e.scope_weapon = ${c.scopeWeapon}
    AND e.valid_from = ${c.validFrom}
    AND ${canonica(sql`e.person_id`)} = ${personaCanonica(c)}`;
}

export function sqlActualizarIdPropio(c: IdExternoCandidato): SQL {
  return sql`UPDATE sport_external_id AS e
    SET valid_to = ${c.validTo}, linked_via = ${c.linkedVia},
        linked_at = ${AHORA_SQL}, evidence = ${c.evidence}, updated_at = ${AHORA_SQL}
    WHERE ${propia(c)} AND NOT ${sqlHayChoque(c)}
    RETURNING id`;
}

/** Segunda sentencia del batch: no vuelve a insertar una fila propia fundida. */
export function sqlConfirmarPersonaExistente(c: IdExternoCandidato): SQL {
  return sql`INSERT INTO sport_external_id (
    person_id, scheme, value, scope_source, scope_federation, scope_season,
    scope_weapon, valid_from, valid_to, link_status, linked_via, linked_at, evidence
  )
  SELECT ${c.personId}, ${c.scheme}, ${c.value.trim()}, ${c.scopeSource},
    ${c.scopeFederation}, ${c.scopeSeason}, ${c.scopeWeapon},
    ${c.validFrom}, ${c.validTo}, 'CONFIRMADO', ${c.linkedVia}, ${AHORA_SQL}, ${c.evidence}
  WHERE ${personaCanonica(c)} IS NOT NULL
    AND NOT ${sqlHayChoque(c)}
    AND NOT EXISTS (SELECT 1 FROM sport_external_id e WHERE ${propia(c)})
  ON CONFLICT (person_id, scheme, value, scope_source, scope_federation, scope_season, scope_weapon, valid_from)
  DO UPDATE SET link_status = 'CONFIRMADO', valid_to = excluded.valid_to,
    linked_via = excluded.linked_via, linked_at = excluded.linked_at,
    evidence = excluded.evidence, updated_at = ${AHORA_SQL}
  RETURNING id`;
}

/** Primera sentencia del alta atómica. Ninguna persona huérfana si hay choque. */
export function sqlConfirmarPersonaNueva(c: IdExternoCandidato, p: PersonaNuevaConId): SQL {
  return sql`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code)
    SELECT ${p.id}, ${p.displayName}, ${p.nameNormalized}, ${p.gender}, ${p.countryCode}
    WHERE ${personaCanonica(c)} IS NOT NULL AND NOT ${sqlHayChoque(c)}
    RETURNING id`;
}

function filasDe(resultado: unknown): Record<string, unknown>[] {
  if (Array.isArray(resultado)) return resultado;
  const rows = (resultado as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

export function crearGuardDb(db: Pick<Db, 'batch' | 'execute'>): DepsGuardConfirmacion {
  return {
    async confirmar(c, p) {
      if (p && p.id !== c.personId) return false;
      const sentencias = p ? [
        sqlConfirmarPersonaNueva(c, p),
        sql`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized)
          SELECT ${p.id}, ${p.aliasSource}, ${p.displayName}, ${p.nameNormalized}
          WHERE EXISTS (SELECT 1 FROM sport_person WHERE id = ${p.id}) AND NOT ${sqlHayChoque(c)}
          ON CONFLICT DO NOTHING`,
        sqlConfirmarPersonaExistente(c),
      ] : [sqlActualizarIdPropio(c), sqlConfirmarPersonaExistente(c)];
      const resultados = await db.batch(sentencias.map((s) => db.execute(s)) as [
        ReturnType<Db['execute']>, ...ReturnType<Db['execute']>[],
      ]);
      return p
        ? filasDe(resultados.at(-1)).length > 0
        : resultados.some((r) => filasDe(r).length > 0);
    },
    async conflictos(c) {
      const resultado = await db.execute(sql`
        SELECT e.person_id AS "personId", e.scheme, e.value, e.scope_source AS "scopeSource",
          e.scope_federation AS "scopeFederation", e.scope_season AS "scopeSeason",
          e.scope_weapon AS "scopeWeapon", e.valid_from AS "validFrom",
          e.valid_to AS "validTo", e.link_status AS "linkStatus"
        FROM sport_external_id e
        WHERE e.link_status = 'CONFIRMADO' AND e.scheme = ${c.scheme}
          AND e.value = ${c.value.trim()} AND e.scope_source = ${c.scopeSource}
          AND (e.scope_federation = '' OR ${c.scopeFederation} = '' OR e.scope_federation = ${c.scopeFederation})
          AND (e.scope_season = '' OR ${c.scopeSeason} = '' OR e.scope_season = ${c.scopeSeason})
          AND (e.scope_weapon = '' OR ${c.scopeWeapon} = '' OR e.scope_weapon = ${c.scopeWeapon})
          AND e.valid_from <= coalesce(${c.validTo}, '9999-12-31')
          AND ${c.validFrom} <= coalesce(e.valid_to, '9999-12-31')
          AND coalesce(${canonica(sql`e.person_id`)}, e.person_id) <> ${personaCanonica(c)}`);
      return filasDe(resultado) as unknown as ExternalIdRow[];
    },
  };
}
