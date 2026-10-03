import { and, eq, inArray, isNotNull, ne, or, sql, type AnyColumn } from 'drizzle-orm';
import type { Db } from '@/db';
import { athlete, fieFencer, sportExternalId, sportPerson } from '@/db/schema';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import type { DepsGuardConfirmacion } from '@/lib/sport/id-guard';
import { crearGuardDb } from '@/lib/sport/id-guard-db';
import { verificarEsquemaD1 } from '../sport-incremental/schema';

export function lotesD1<T>(values: readonly T[], size = 45): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
export const esquemaD1 = (db: Db) => () => verificarEsquemaD1(db);
/** These TEXT categories are explicitly checked by the foundation schema. */
export const categoriasD1 = (db: Db) => async () => {
  await verificarEsquemaD1(db);
  return true;
};
const licencia = (column: AnyColumn) => sql`upper(replace(replace(${column},' ',''),'-',''))`;
/** Select only defined fields; never hydrate entire legacy/target schema rows. */
export function evidenciaD1(db: Db): DepsEvidencia {
  return {
    esquema: esquemaD1(db),
    async atletasPorLicencia(values) {
      const out = [];
      for (const v of lotesD1(values)) out.push(...await db.select({
        id: athlete.id, rfeeLicense: athlete.rfeeLicense, rfeeValidUntil: athlete.rfeeLicenseValidUntil,
        fieLicense: athlete.fieLicense, fieValidUntil: athlete.fieLicenseValidUntil,
      }).from(athlete).where(or(inArray(licencia(athlete.rfeeLicense), v), inArray(licencia(athlete.fieLicense), v))));
      return out;
    },
    async fichasFie(ids, licenses) {
      const out = [];
      const confirmed = and(isNotNull(fieFencer.athleteId), eq(fieFencer.linkStatus, 'CONFIRMADO'));
      for (const v of lotesD1(ids)) out.push(...await db.select({
        fieId: fieFencer.fieId, fieLicense: fieFencer.fieLicense, athleteId: fieFencer.athleteId,
      }).from(fieFencer).where(and(inArray(fieFencer.fieId, v), confirmed)));
      for (const v of lotesD1(licenses)) out.push(...await db.select({
        fieId: fieFencer.fieId, fieLicense: fieFencer.fieLicense, athleteId: fieFencer.athleteId,
      }).from(fieFencer).where(and(inArray(licencia(fieFencer.fieLicense), v), confirmed)));
      return out.flatMap((r) => r.athleteId ? [{ ...r, athleteId: r.athleteId }] : []);
    },
    async externos(values) {
      const out: ExternalIdRow[] = [];
      for (const v of lotesD1(values)) out.push(...await db.select({
        personId: sportExternalId.personId, scheme: sportExternalId.scheme, value: sportExternalId.value,
        scopeSource: sportExternalId.scopeSource, scopeFederation: sportExternalId.scopeFederation,
        scopeSeason: sportExternalId.scopeSeason, scopeWeapon: sportExternalId.scopeWeapon,
        validFrom: sportExternalId.validFrom, validTo: sportExternalId.validTo, linkStatus: sportExternalId.linkStatus,
      }).from(sportExternalId).where(and(inArray(sportExternalId.value, v), ne(sportExternalId.linkStatus, 'RECHAZADO'))));
      return out;
    },
    async personas(ids) {
      const out = new Map();
      for (const v of lotesD1(ids)) for (const r of await db.select({
        id: sportPerson.id, athleteId: sportPerson.athleteId, mergedIntoPersonId: sportPerson.mergedIntoPersonId,
      }).from(sportPerson).where(inArray(sportPerson.id, v))) out.set(r.id, {
        athleteId: r.athleteId, mergedIntoPersonId: r.mergedIntoPersonId,
      });
      return out;
    },
  };
}
/** Reuse the shared native D1 identity rules, including bounded merge chains.
 * The injected Db MUST be owner-bound. No alternate unfenced identity writer. */
export function crearGuardIdentidadD1(db: Db): DepsGuardConfirmacion {
  return crearGuardDb(db);
}
