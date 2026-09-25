'use server';

import { eq, inArray, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { ingestQuarantine } from '@/db/schema';
import { requireRole } from '@/lib/auth/session';

export type ResultadoAccion =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Marca una fila de cuarentena como resuelta.
 *
 * "Resuelta" quiere decir "ya la he mirado", no "el dato ha entrado". La fila
 * no se borra nunca: es la prueba de qué venía mal y cuándo, y sirve para
 * arreglar el scraper.
 */
export async function resolverCuarentena(id: string): Promise<ResultadoAccion> {
  await requireRole('admin');

  const [fila] = await db
    .update(ingestQuarantine)
    .set({ resolvedAt: new Date() })
    .where(eq(ingestQuarantine.id, id))
    .returning({ id: ingestQuarantine.id });

  if (!fila) return { ok: false, error: 'Esa fila ya no existe.' };

  revalidatePath('/admin/cuarentena');
  revalidatePath('/admin');
  return { ok: true, message: 'Marcada como revisada.' };
}

/** Marca varias de golpe, que es como se revisa cuando el fallo es el mismo. */
export async function resolverVarias(ids: string[]): Promise<ResultadoAccion> {
  await requireRole('admin');
  if (ids.length === 0) return { ok: false, error: 'No has seleccionado ninguna.' };

  const filas = await db
    .update(ingestQuarantine)
    .set({ resolvedAt: new Date() })
    .where(inArray(ingestQuarantine.id, ids))
    .returning({ id: ingestQuarantine.id });

  revalidatePath('/admin/cuarentena');
  revalidatePath('/admin');
  return { ok: true, message: `${filas.length} filas marcadas como revisadas.` };
}

/** Devuelve una fila a "pendiente" si se marcó por error. */
export async function reabrirCuarentena(id: string): Promise<ResultadoAccion> {
  await requireRole('admin');

  await db
    .update(ingestQuarantine)
    .set({ resolvedAt: null })
    .where(eq(ingestQuarantine.id, id));

  revalidatePath('/admin/cuarentena');
  revalidatePath('/admin');
  return { ok: true, message: 'Vuelve a estar pendiente de revisar.' };
}

/** Nº de filas sin resolver. Se usa tras una acción para refrescar el aviso. */
export async function contarPendientes(): Promise<number> {
  await requireRole('admin');
  const filas = await db
    .select({ id: ingestQuarantine.id })
    .from(ingestQuarantine)
    .where(isNull(ingestQuarantine.resolvedAt));
  return filas.length;
}
