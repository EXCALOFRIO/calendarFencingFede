'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { userProfile } from '@/db/schema';
import { newIcalToken, requireProfile } from '@/lib/auth/session';

export type ResultadoPerfil =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Genera un token nuevo para los feeds iCal.
 *
 * La URL del calendario lleva la credencial dentro porque ni Google Calendar
 * ni Apple Calendar saben enviar cabeceras de autenticación. Esa es la razón
 * de que se pueda revocar: si la dirección se comparte sin querer, se cambia
 * el token y la anterior deja de responder al instante.
 *
 * Solo se toca el perfil de quien llama; no recibe ningún identificador de
 * fuera, así que no hay nada que suplantar.
 */
export async function revocarCalendario(): Promise<ResultadoPerfil> {
  const perfil = await requireProfile();

  await db
    .update(userProfile)
    .set({ icalToken: newIcalToken(), updatedAt: new Date() })
    .where(eq(userProfile.id, perfil.profileId));

  revalidatePath('/perfil');

  return {
    ok: true,
    message:
      'Hecho: las direcciones anteriores ya no funcionan. Vuelve a suscribir ' +
      'el calendario en tu móvil con la dirección nueva.',
  };
}
