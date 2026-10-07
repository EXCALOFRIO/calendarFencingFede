'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { athlete, result } from '@/db/schema';
import { requireWritableRole } from '@/lib/auth/session';
import { invalidarCacheSinFallar, type Dependencia } from '@/lib/cache';

/**
 * `result` alimenta el ranking nacional y `athlete` (con su licencia) el
 * enlace de las fichas deportivas y del ranking FIE: ninguna es `sport_*`, así
 * que el ledger no sube la versión de `deporte` por sí solo.
 */
const DEPENDENCIAS_EMPAREJADO: readonly Dependencia[] = ['deporte', 'ranking', 'ranking-fie'];

export type ResultadoAccion =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Asigna un resultado a un tirador.
 *
 * Siempre a mano y siempre con un clic de una persona. El emparejado
 * automático por nombre está descartado a propósito: hay homónimos y las
 * fuentes escriben los acentos como les parece, así que un emparejado
 * automático acaba metiendo los puntos de un tirador en el ranking de otro.
 */
export async function asignarResultado(
  resultId: string,
  athleteId: string,
  opciones: { guardarLicencia?: boolean } = {},
): Promise<ResultadoAccion> {
  await requireWritableRole('admin');

  const [fila] = await db
    .select({
      id: result.id,
      sourceLicense: result.sourceLicense,
      sourceAthleteName: result.sourceAthleteName,
      athleteId: result.athleteId,
    })
    .from(result)
    .where(eq(result.id, resultId))
    .limit(1);

  if (!fila) return { ok: false, error: 'Ese resultado ya no existe.' };

  const [tirador] = await db
    .select({
      id: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      rfeeLicense: athlete.rfeeLicense,
    })
    .from(athlete)
    .where(eq(athlete.id, athleteId))
    .limit(1);

  if (!tirador) return { ok: false, error: 'Ese tirador ya no existe.' };

  await db.update(result).set({ athleteId }).where(eq(result.id, resultId));

  /**
   * Guardar la licencia en la ficha es lo que evita repetir este trabajo: a
   * partir de ahí los resultados de esa persona se emparejan solos por
   * licencia, que sí es una clave fiable.
   */
  let licenciaGuardada = false;
  if (opciones.guardarLicencia && fila.sourceLicense && !tirador.rfeeLicense) {
    try {
      await db
        .update(athlete)
        .set({ rfeeLicense: fila.sourceLicense, updatedAt: new Date() })
        .where(eq(athlete.id, athleteId));
      licenciaGuardada = true;
    } catch {
      await invalidarCacheSinFallar(DEPENDENCIAS_EMPAREJADO, 'emparejar');
      // La licencia es única: si ya la tiene otro, se avisa en vez de romper.
      return {
        ok: true,
        message:
          'Resultado asignado, pero la licencia no se ha podido guardar en la ' +
          'ficha porque ya figura en otro tirador. Revísalo: una de las dos ' +
          'fichas está mal.',
      };
    }
  }

  await invalidarCacheSinFallar(DEPENDENCIAS_EMPAREJADO, 'emparejar');
  revalidatePath('/admin/emparejar');
  revalidatePath('/admin');

  return {
    ok: true,
    message:
      `Resultado de "${fila.sourceAthleteName}" asignado a ${tirador.firstName} ` +
      `${tirador.lastName}.` +
      (licenciaGuardada
        ? ' La licencia se ha guardado en su ficha, así que los próximos se emparejarán solos.'
        : ''),
  };
}

/**
 * Asigna de golpe todos los resultados pendientes que traen exactamente el
 * mismo nombre de origen. Sigue decidiéndolo una persona: lo que se ahorra es
 * repetir veinte veces el mismo clic, no la comprobación.
 */
export async function asignarTodosConEseNombre(
  sourceAthleteName: string,
  athleteId: string,
): Promise<ResultadoAccion> {
  await requireWritableRole('admin');

  const filas = await db
    .update(result)
    .set({ athleteId })
    .where(
      and(
        isNull(result.athleteId),
        eq(result.sourceAthleteName, sourceAthleteName),
      ),
    )
    .returning({ id: result.id });

  if (filas.length > 0) await invalidarCacheSinFallar(DEPENDENCIAS_EMPAREJADO, 'emparejar');
  revalidatePath('/admin/emparejar');
  revalidatePath('/admin');

  return {
    ok: true,
    message: `${filas.length} resultados de "${sourceAthleteName}" asignados.`,
  };
}

/** Deshace una asignación equivocada. */
export async function desasignarResultado(resultId: string): Promise<ResultadoAccion> {
  await requireWritableRole('admin');
  await db.update(result).set({ athleteId: null }).where(eq(result.id, resultId));
  await invalidarCacheSinFallar(DEPENDENCIAS_EMPAREJADO, 'emparejar');
  revalidatePath('/admin/emparejar');
  return { ok: true, message: 'Resultado devuelto a la cola de sin emparejar.' };
}
