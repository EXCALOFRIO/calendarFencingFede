'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { event } from '@/db/schema';
import { requireWritableRole } from '@/lib/auth/session';
import { invalidarCacheSinFallar } from '@/lib/cache';

/**
 * Marca un evento como cancelado (o le quita la marca si fue un error).
 *
 * A mano y siempre con un clic de una persona, como el emparejado: la
 * detección de `/admin/salud` propone, la dirección técnica decide. Marcarla
 * no la borra — inscripciones, iCal y el «Cancelada» del calendario se
 * apoyan en la fila, que se queda.
 */
export async function marcarCancelada(
  eventId: string,
  cancelada: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireWritableRole('admin');

  const [fila] = await db
    .select({ id: event.id })
    .from(event)
    .where(eq(event.id, eventId))
    .limit(1);
  if (!fila) return { ok: false, error: 'Ese evento ya no existe.' };

  await db.update(event).set({ cancelled: cancelada }).where(eq(event.id, eventId));
  await invalidarCacheSinFallar(['calendario'], 'cancelar');
  revalidatePath('/admin/salud');
  revalidatePath('/');
  return { ok: true };
}
