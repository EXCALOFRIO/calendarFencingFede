import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import type {
  DepsGuardConfirmacion,
  IdExternoCandidato,
  PersonaNuevaConId,
} from './id-guard';

/**
 * Comprobación + escritura atómica del guard de IDs externos.
 *
 * Neon por HTTP no tiene transacciones interactivas, pero `db.batch` ejecuta
 * sus sentencias en UNA transacción (READ COMMITTED: cada sentencia ve lo ya
 * confirmado). Por eso van dos: primero un cerrojo consultivo por
 * `(scheme, value, scope_source)`, que serializa a todo el que quiera
 * confirmar ese mismo ID; y después el INSERT condicionado a que no exista un
 * choque. Si el cerrojo y el INSERT fueran una sola sentencia, el INSERT
 * ya habría tomado su instantánea y no vería a quien confirmó mientras esperaba.
 *
 * La condición repite en SQL la regla de `id-guard.ts` (ámbitos con vacío
 * comodín, vigencias inclusivas con fin abierto, persona distinta siguiendo
 * una fusión); los tests comparan ambas sobre los mismos casos.
 */

type Filas = { id?: string }[];

function filasDe(resultado: unknown): Filas {
  if (Array.isArray(resultado)) return resultado as Filas;
  const rows = (resultado as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Filas) : [];
}

function cerrojo(c: IdExternoCandidato): SQL {
  const clave = `sport_external_id|${c.scheme}|${c.value.trim()}|${c.scopeSource}`;
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${clave}, 0))`;
}

/** Hay otra persona confirmada con el mismo ID, ámbito compatible y vigencia solapada. */
export function sqlHayChoque(c: IdExternoCandidato): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM sport_external_id e
    LEFT JOIN sport_person ep ON ep.id = e.person_id
    WHERE e.link_status = 'CONFIRMADO'
      AND e.scheme = ${c.scheme}
      AND e.value = ${c.value.trim()}
      AND e.scope_source = ${c.scopeSource}
      AND (e.scope_federation = '' OR ${c.scopeFederation} = '' OR e.scope_federation = ${c.scopeFederation})
      AND (e.scope_season = '' OR ${c.scopeSeason} = '' OR e.scope_season = ${c.scopeSeason})
      AND (e.scope_weapon = '' OR ${c.scopeWeapon} = '' OR e.scope_weapon = ${c.scopeWeapon})
      AND e.valid_from <= coalesce(${c.validTo}::date, 'infinity'::date)
      AND ${c.validFrom}::date <= coalesce(e.valid_to, 'infinity'::date)
      AND coalesce(ep.merged_into_person_id, e.person_id) <> ${c.personId}::uuid
  )`;
}

function columnasId(c: IdExternoCandidato): SQL {
  return sql`${c.scheme}, ${c.value.trim()}, ${c.scopeSource}, ${c.scopeFederation}, ${c.scopeSeason}, ${c.scopeWeapon}, ${c.validFrom}::date, ${c.validTo}::date, 'CONFIRMADO'::sport_link_status, ${c.linkedVia}, now(), ${c.evidence}`;
}

const NOMBRES_ID = sql.raw(
  'scheme, value, scope_source, scope_federation, scope_season, scope_weapon, valid_from, valid_to, link_status, linked_via, linked_at, evidence',
);

export function sqlConfirmarPersonaExistente(c: IdExternoCandidato): SQL {
  return sql`INSERT INTO sport_external_id (person_id, ${NOMBRES_ID})
    SELECT ${c.personId}::uuid, ${columnasId(c)}
    WHERE NOT ${sqlHayChoque(c)}
    ON CONFLICT ON CONSTRAINT sport_external_id_person_key DO UPDATE
      SET link_status = 'CONFIRMADO',
          valid_to = excluded.valid_to,
          linked_via = excluded.linked_via,
          linked_at = excluded.linked_at,
          evidence = excluded.evidence,
          updated_at = now()
    RETURNING id`;
}

export function sqlConfirmarPersonaNueva(c: IdExternoCandidato, p: PersonaNuevaConId): SQL {
  return sql`WITH nueva AS (
      INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code)
      SELECT ${p.id}::uuid, ${p.displayName}, ${p.nameNormalized}, ${p.gender}::gender, ${p.countryCode}
      WHERE NOT ${sqlHayChoque(c)}
      RETURNING id
    ),
    alias AS (
      INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized)
      SELECT id, ${p.aliasSource}, ${p.displayName}, ${p.nameNormalized} FROM nueva
      ON CONFLICT DO NOTHING
    )
    INSERT INTO sport_external_id (person_id, ${NOMBRES_ID})
    SELECT id, ${columnasId(c)} FROM nueva
    RETURNING id`;
}

export function crearGuardDb(db: Pick<Db, 'batch' | 'execute'>): DepsGuardConfirmacion {
  return {
    async confirmar(candidato, persona) {
      const escritura = persona
        ? sqlConfirmarPersonaNueva(candidato, persona)
        : sqlConfirmarPersonaExistente(candidato);
      const [, resultado] = await db.batch([
        db.execute(cerrojo(candidato)),
        db.execute(escritura),
      ]);
      return filasDe(resultado).length > 0;
    },

    async conflictos(candidato) {
      const resultado = await db.execute(sql`
        SELECT e.person_id AS "personId", e.scheme, e.value, e.scope_source AS "scopeSource",
               e.scope_federation AS "scopeFederation", e.scope_season AS "scopeSeason",
               e.scope_weapon AS "scopeWeapon", e.valid_from::text AS "validFrom",
               e.valid_to::text AS "validTo", e.link_status AS "linkStatus"
        FROM sport_external_id e
        LEFT JOIN sport_person ep ON ep.id = e.person_id
        WHERE e.link_status = 'CONFIRMADO'
          AND e.scheme = ${candidato.scheme}
          AND e.value = ${candidato.value.trim()}
          AND e.scope_source = ${candidato.scopeSource}
          AND (e.scope_federation = '' OR ${candidato.scopeFederation} = '' OR e.scope_federation = ${candidato.scopeFederation})
          AND (e.scope_season = '' OR ${candidato.scopeSeason} = '' OR e.scope_season = ${candidato.scopeSeason})
          AND (e.scope_weapon = '' OR ${candidato.scopeWeapon} = '' OR e.scope_weapon = ${candidato.scopeWeapon})
          AND e.valid_from <= coalesce(${candidato.validTo}::date, 'infinity'::date)
          AND ${candidato.validFrom}::date <= coalesce(e.valid_to, 'infinity'::date)
          AND coalesce(ep.merged_into_person_id, e.person_id) <> ${candidato.personId}::uuid`);
      return filasDe(resultado) as unknown as ExternalIdRow[];
    },
  };
}
