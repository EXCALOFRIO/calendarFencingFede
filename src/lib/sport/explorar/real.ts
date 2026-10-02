import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { sportPerson } from '@/db/schema';
import { getManagedAthletes, getSessionProfile } from '@/lib/auth/session';
import { depsEvidenciaDb } from '@/lib/entries/evidencia-db';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import type { ContextoExplorador } from './contexto';

/**
 * Único punto que conecta el explorador con Neon y con la sesión real. El
 * perfil sale de `getSessionProfile`, que devuelve `null` sin sesión y con
 * acceso revocado; no hay otra vía de identidad.
 */
export function contextoReal(): ContextoExplorador {
  return {
    db,
    perfil: getSessionProfile,
    esquema: esquemaDeportivo,
    hoy: () => new Date().toISOString().slice(0, 10),
    propietario: {
      async atletasDeCuenta(profileId) {
        const mios = await getManagedAthletes(profileId);
        return mios.map((a) => ({
          id: a.id,
          rfeeLicense: a.rfeeLicense,
          rfeeValidUntil: a.rfeeLicenseValidUntil,
          fieLicense: a.fieLicense,
          fieValidUntil: a.fieLicenseValidUntil,
        }));
      },
      async personasEnlazadas(athleteIds) {
        if (athleteIds.length === 0) return [];
        const filas = await db
          .select({ personId: sportPerson.id, athleteId: sportPerson.athleteId })
          .from(sportPerson)
          .where(inArray(sportPerson.athleteId, athleteIds));
        return filas.flatMap((f) => (f.athleteId ? [{ personId: f.personId, athleteId: f.athleteId }] : []));
      },
      fichasFiePorAtleta: depsEvidenciaDb.fichasFiePorAtleta,
      evidencia: depsEvidenciaDb,
    },
  };
}
