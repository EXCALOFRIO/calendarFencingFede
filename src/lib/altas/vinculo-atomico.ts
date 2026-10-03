import { sql, type SQL } from 'drizzle-orm';
import { db, type Db } from '@/db';
import { nowMilliseconds } from '@/db/d1/columns';

export type AprobacionVinculo = {
  solicitudId: string;
  adminProfileId: string;
  evidencia: string;
};

/** Rechecked inside the same write, including cross-column ownership. */
export function cuentaSinFicha(profileId: string): SQL {
  return sql`exists (
    select 1 from user_profile p where p.id = ${profileId}
      and p.role = 'athlete' and p.invite_status in ('pendiente','aceptada')
  ) and not exists (
    select 1 from athlete a where a.active = 1
      and (a.user_profile_id = ${profileId} or a.guardian_profile_id = ${profileId})
  )`;
}

export function aprobacionVigente(
  aprobacion: AprobacionVinculo,
  profileId: string,
  clave: string,
): SQL {
  return sql`exists (
    select 1 from athlete_link_request r
    join user_profile admin on admin.id = ${aprobacion.adminProfileId}
    where r.id = ${aprobacion.solicitudId} and r.profile_id = ${profileId}
      and r.source_key = ${clave} and r.state = 'PENDIENTE'
      and admin.role = 'admin' and admin.invite_status in ('pendiente','aceptada')
  )`;
}

export function evidenciaValida(aprobacion: AprobacionVinculo): boolean {
  return aprobacion.evidencia.trim().length >= 20 && aprobacion.evidencia.length <= 1000;
}

/**
 * A zero-row CAS must abort the ENTIRE D1 batch, not just skip the ownership
 * write and commit its dependent changes. SQLite's lazy CASE raises a fixed
 * integer-overflow error only on failure. Never expose driver errors/params.
 */
export const exigirUnCambio = sql`select case when changes() = 1
  then 1 else abs(-9223372036854775808) end as ownership_cas`;

export function cierreAprobacion(
  aprobacion: AprobacionVinculo,
  profileId: string,
  clave: string,
  athleteId: string,
): SQL[] {
  return [
    sql`update athlete_link_request set state = 'APROBADA',
      reviewed_at = ${nowMilliseconds}, reviewed_by_profile_id = ${aprobacion.adminProfileId},
      athlete_id = ${athleteId}, evidence = ${aprobacion.evidencia.trim()}
      where id = ${aprobacion.solicitudId} and profile_id = ${profileId}
        and source_key = ${clave} and state = 'PENDIENTE'`,
    exigirUnCambio,
  ];
}

/** Explicitly bounded atomic batch; no interactive transaction or fallback. */
export async function escribirVinculoAtomico(
  queries: readonly SQL[],
  database: Db = db,
): Promise<ReadonlyArray<{ rows: Record<string, unknown>[] }> | null> {
  if (queries.length === 0 || queries.length > 20) throw new Error('VINCULO_BATCH_INVALIDO');
  const [first, ...rest] = queries.map((query) => database.execute(query));
  try {
    return await database.batch([first, ...rest]);
  } catch {
    // Drizzle error causes can contain names/emails. The caller gets a stable,
    // non-sensitive failure and must never report success after a lost CAS.
    return null;
  }
}
