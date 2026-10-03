import { and, desc, eq, sql } from 'drizzle-orm';
import { db, type Db } from '@/db';
import { nowMilliseconds } from '@/db/d1/columns';
import { athlete, fieFencer, officialRankingEntry, userProfile } from '@/db/schema';
import type { MotivoRechazo } from './desde-ranking';
import { athleteLinkRequest } from './solicitudes-schema';
import { normalizarLicencia } from './texto';
import { cuentaSinFicha } from './vinculo-atomico';

export type ResultadoSolicitud =
  | { ok: true; solicitudId: string; pendiente: true }
  | { ok: false; motivo: MotivoRechazo };

export function claveVinculoValida(clave: string): boolean {
  if (/^rfee:[a-z0-9_-]{1,128}$/i.test(clave)) return true;
  if (!/^fie:[1-9]\d{0,9}$/.test(clave)) return false;
  return Number(clave.slice(4)) <= 2_147_483_647;
}

export async function solicitarVinculo({
  profileId, clave, nombreEscrito, licencia,
}: {
  profileId: string;
  clave: string;
  nombreEscrito: string;
  licencia?: string;
}, database: Db = db): Promise<ResultadoSolicitud> {
  if (!claveVinculoValida(clave) || nombreEscrito.length > 160) {
    return { ok: false, motivo: 'NO_ENCONTRADO' };
  }
  const [perfil] = await database.select({ id: userProfile.id }).from(userProfile)
    .where(and(eq(userProfile.id, profileId), eq(userProfile.role, 'athlete'),
      sql`${userProfile.inviteStatus} in ('pendiente','aceptada')`)).limit(1);
  if (!perfil) return { ok: false, motivo: 'CUENTA_NO_ELEGIBLE' };
  const [suya] = await database.select({ id: athlete.id }).from(athlete)
    .where(sql`${athlete.active} = 1 and
      (${athlete.userProfileId} = ${profileId} or ${athlete.guardianProfileId} = ${profileId})`).limit(1);
  if (suya) return { ok: false, motivo: 'YA_TIENES_FICHA' };

  const [pendiente] = await database.select({ id: athleteLinkRequest.id, clave: athleteLinkRequest.sourceKey })
    .from(athleteLinkRequest).where(and(eq(athleteLinkRequest.profileId, profileId),
      eq(athleteLinkRequest.state, 'PENDIENTE'))).limit(1);
  if (pendiente) {
    return pendiente.clave === clave
      ? { ok: true, solicitudId: pendiente.id, pendiente: true }
      : { ok: false, motivo: 'SOLICITUD_PENDIENTE' };
  }

  let fuenteVigente;
  if (clave.startsWith('rfee:')) {
    const id = clave.slice(5);
    const [fila] = await database.select({
      nacimiento: officialRankingEntry.sourceBirthDate,
      licencia: officialRankingEntry.sourceLicense,
    }).from(officialRankingEntry).where(eq(officialRankingEntry.skermoAthleteId, id))
      .orderBy(desc(officialRankingEntry.seasonLabel)).limit(1);
    if (!fila) return { ok: false, motivo: 'NO_ENCONTRADO' };
    if (!fila.nacimiento) return { ok: false, motivo: 'SIN_LICENCIA_EN_LA_FUENTE' };
    if (licencia !== undefined && (!fila.licencia ||
      normalizarLicencia(licencia) !== normalizarLicencia(fila.licencia))) {
      // A license can help locate a record, but is not an ownership credential.
      return { ok: false, motivo: 'LICENCIA_NO_COINCIDE' };
    }
    fuenteVigente = sql`exists (select 1 from official_ranking_entry
      where skermo_athlete_id = ${id} and source_birth_date is not null)`;
  } else {
    const id = Number(clave.slice(4));
    const [fila] = await database.select({ nacimiento: fieFencer.sourceBirthDate })
      .from(fieFencer).where(and(eq(fieFencer.fieId, id), eq(fieFencer.countryCode, 'ESP'))).limit(1);
    if (!fila) return { ok: false, motivo: 'NO_ENCONTRADO' };
    if (!fila.nacimiento) return { ok: false, motivo: 'SIN_LICENCIA_EN_LA_FUENTE' };
    fuenteVigente = sql`exists (select 1 from fie_fencer
      where fie_id = ${id} and country_code = 'ESP' and source_birth_date is not null)`;
  }
  const id = crypto.randomUUID();
  const result = await database.execute<{ id: string }>(sql`
    insert into athlete_link_request(id,profile_id,source_key,claimed_name,state,requested_at)
    select ${id},${profileId},${clave},${nombreEscrito.trim()},'PENDIENTE',${nowMilliseconds}
    where ${cuentaSinFicha(profileId)} and ${fuenteVigente}
      and (select count(*) from athlete_link_request
        where profile_id = ${profileId} and requested_at > ${nowMilliseconds} - 86400000) < 5
    on conflict(profile_id) where state = 'PENDIENTE' do nothing returning id`);
  if (result.rows.length === 1) return { ok: true, solicitudId: id, pendiente: true };
  const [actual] = await database.select({ id: athleteLinkRequest.id, clave: athleteLinkRequest.sourceKey })
    .from(athleteLinkRequest).where(and(eq(athleteLinkRequest.profileId, profileId),
      eq(athleteLinkRequest.state, 'PENDIENTE'))).limit(1);
  return actual?.clave === clave
    ? { ok: true, solicitudId: actual.id, pendiente: true }
    : { ok: false, motivo: actual ? 'SOLICITUD_PENDIENTE' : 'DEMASIADOS_INTENTOS' };
}

export async function solicitudPendiente(profileId: string, database: Db = db) {
  const [solicitud] = await database.select({
    id: athleteLinkRequest.id,
    clave: athleteLinkRequest.sourceKey,
    fecha: athleteLinkRequest.requestedAt,
  }).from(athleteLinkRequest).where(and(eq(athleteLinkRequest.profileId, profileId),
    eq(athleteLinkRequest.state, 'PENDIENTE'))).limit(1);
  return solicitud ?? null;
}

/** Minimal admin-only DTO. No provider data, DOB, license or session material. */
export async function listarSolicitudesVinculo(database: Db = db) {
  return database.execute<{
    id: string; profileId: string; cuenta: string; email: string; clave: string;
    solicitada: number; nombreFuente: string | null; anio: number | null;
  }>(sql`select r.id, r.profile_id as profileId, p.full_name as cuenta,
    p.email, r.source_key as clave, r.requested_at as solicitada,
    case when substr(r.source_key,1,5) = 'rfee:'
      then (select source_athlete_name from official_ranking_entry
        where skermo_athlete_id = substr(r.source_key,6) order by season_label desc limit 1)
      else (select source_name from fie_fencer where fie_id = cast(substr(r.source_key,5) as integer))
    end as nombreFuente,
    case when substr(r.source_key,1,5) = 'rfee:'
      then (select cast(substr(source_birth_date,1,4) as integer) from official_ranking_entry
        where skermo_athlete_id = substr(r.source_key,6) order by season_label desc limit 1)
      else (select cast(substr(source_birth_date,1,4) as integer) from fie_fencer
        where fie_id = cast(substr(r.source_key,5) as integer))
    end as anio
    from athlete_link_request r join user_profile p on p.id = r.profile_id
    where r.state = 'PENDIENTE' order by r.requested_at,r.id limit 50`)
    .then((result) => result.rows);
}
