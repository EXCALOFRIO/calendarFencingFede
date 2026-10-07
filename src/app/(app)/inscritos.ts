'use server';

import { requireProfile } from '@/lib/auth/session';
import { calendarioCompartido } from '@/lib/queries/calendario-cache';
import { idDeEventoValido } from '@/lib/queries/calendario-cache-modelo';
import { quienVaDelEvento, type QuienVa } from '@/lib/queries/quien-va';

export type { Inscrito, QuienVa } from '@/lib/queries/quien-va';

/**
 * Quién va a cada prueba de un torneo (ver `quien-va.ts`). La lista oficial
 * sale de la caché compartida; lo de la cuenta se aplica en la petición.
 *
 * `requireProfile` va antes de nada: una acción de servidor es una ruta, y
 * esto no es información pública dentro de la app.
 */
export async function inscritosDelEvento(eventId: string): Promise<QuienVa> {
  const perfil = await requireProfile();
  if (!idDeEventoValido(eventId)) return { oficiales: [], estados: {}, pendientes: [] };
  return quienVaDelEvento(perfil, eventId, calendarioCompartido.listaPublica(eventId));
}
