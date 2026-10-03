import { and, eq, isNotNull, ne, or, sql, type AnyColumn } from 'drizzle-orm';
import { enLista as inArray } from '@/lib/sqlite';
import { db } from '@/db';
import { athlete, fieFencer, sportExternalId, sportPerson } from '@/db/schema';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import type { DepsEvidencia } from './evidencia';
import type { PersonaDeportiva } from './identidad';

const LOTE = 300;

function lotes<T>(items: readonly T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += LOTE) salida.push(items.slice(i, i + LOTE));
  return salida;
}

const licenciaSql = (columna: AnyColumn) =>
  sql`upper(replace(replace(${columna}, ' ', ''), '-', ''))`;

export const depsEvidenciaDb: DepsEvidencia & {
  fichasFiePorAtleta: (
    athleteIds: string[],
  ) => Promise<{ fieId: number; fieLicense: string | null }[]>;
} = {
  esquema: esquemaDeportivo,

  async fichasFiePorAtleta(athleteIds) {
    const salida = [];
    for (const lote of lotes(athleteIds)) {
      const filas = await db
        .select({ fieId: fieFencer.fieId, fieLicense: fieFencer.fieLicense })
        .from(fieFencer)
        .where(and(inArray(fieFencer.athleteId, lote), eq(fieFencer.linkStatus, 'CONFIRMADO')));
      salida.push(...filas);
    }
    return salida;
  },

  async atletasPorLicencia(licencias) {
    const salida = [];
    for (const lote of lotes(licencias)) {
      const filas = await db
        .select({
          id: athlete.id,
          rfeeLicense: athlete.rfeeLicense,
          rfeeValidUntil: athlete.rfeeLicenseValidUntil,
          fieLicense: athlete.fieLicense,
          fieValidUntil: athlete.fieLicenseValidUntil,
        })
        .from(athlete)
        .where(
          or(
            inArray(licenciaSql(athlete.rfeeLicense), lote),
            inArray(licenciaSql(athlete.fieLicense), lote),
          ),
        );
      salida.push(...filas);
    }
    return salida;
  },

  async fichasFie(fieIds, licencias) {
    const salida = [];
    const confirmada = and(isNotNull(fieFencer.athleteId), eq(fieFencer.linkStatus, 'CONFIRMADO'));
    for (const lote of lotes(fieIds)) {
      const filas = await db
        .select({
          fieId: fieFencer.fieId,
          fieLicense: fieFencer.fieLicense,
          athleteId: fieFencer.athleteId,
        })
        .from(fieFencer)
        .where(and(inArray(fieFencer.fieId, lote), confirmada));
      salida.push(...filas);
    }
    for (const lote of lotes(licencias)) {
      const filas = await db
        .select({
          fieId: fieFencer.fieId,
          fieLicense: fieFencer.fieLicense,
          athleteId: fieFencer.athleteId,
        })
        .from(fieFencer)
        .where(and(inArray(licenciaSql(fieFencer.fieLicense), lote), confirmada));
      salida.push(...filas);
    }
    return salida.flatMap((f) =>
      f.athleteId ? [{ fieId: f.fieId, fieLicense: f.fieLicense, athleteId: f.athleteId }] : [],
    );
  },

  async externos(valores) {
    const salida: ExternalIdRow[] = [];
    for (const lote of lotes(valores)) {
      const filas = await db
        .select({
          personId: sportExternalId.personId,
          scheme: sportExternalId.scheme,
          value: sportExternalId.value,
          scopeSource: sportExternalId.scopeSource,
          scopeFederation: sportExternalId.scopeFederation,
          scopeSeason: sportExternalId.scopeSeason,
          scopeWeapon: sportExternalId.scopeWeapon,
          validFrom: sportExternalId.validFrom,
          validTo: sportExternalId.validTo,
          linkStatus: sportExternalId.linkStatus,
        })
        .from(sportExternalId)
        .where(and(inArray(sportExternalId.value, lote), ne(sportExternalId.linkStatus, 'RECHAZADO')));
      salida.push(...filas);
    }
    return salida;
  },

  async personas(ids) {
    const salida = new Map<string, PersonaDeportiva>();
    for (const lote of lotes(ids)) {
      const filas = await db
        .select({
          id: sportPerson.id,
          athleteId: sportPerson.athleteId,
          mergedIntoPersonId: sportPerson.mergedIntoPersonId,
        })
        .from(sportPerson)
        .where(inArray(sportPerson.id, lote));
      for (const f of filas) {
        salida.set(f.id, { athleteId: f.athleteId, mergedIntoPersonId: f.mergedIntoPersonId });
      }
    }
    return salida;
  },
};
