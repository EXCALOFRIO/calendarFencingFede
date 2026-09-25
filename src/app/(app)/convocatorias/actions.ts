'use server';

import { requireRole } from '@/lib/auth/session';
import {
  type AthletePicker,
  type RankingPrueba,
  getRankingParaEvento,
  listAthletesForPicker,
} from '@/lib/queries/callups';

/**
 * Lecturas que hace el panel de publicación DESPUÉS de cargar la página.
 *
 * Las consultas de `src/lib/queries/callups.ts` no llevan comprobación de
 * permisos —las llama un componente de servidor que ya sabe quién mira—, así
 * que al exponerlas como acción hay que ponerla aquí: una acción de servidor
 * es un endpoint público, y sin esto cualquiera con sesión podría pedir la
 * lista completa de tiradores de la federación.
 *
 * Se cargan a demanda y no con la página porque dependen del evento que se
 * acaba de elegir, y porque traer el ranking de los 300 eventos futuros para
 * pintar una pantalla que casi siempre se mira sin publicar nada sería
 * absurdo.
 */

export type Cargado<T> = { ok: true; datos: T } | { ok: false; error: string };

function fallo(e: unknown): { ok: false; error: string } {
  const mensaje = e instanceof Error ? e.message : 'Error desconocido';
  return {
    ok: false,
    error:
      mensaje === 'NO_AUTENTICADO'
        ? 'Tu sesión ha caducado. Vuelve a entrar.'
        : mensaje,
  };
}

/** Pruebas del evento con el orden del ranking interno, para marcar plazas. */
export async function cargarRankingDelEvento(
  eventId: string,
): Promise<Cargado<{ pruebas: RankingPrueba[]; seasonLabel: string | null }>> {
  try {
    await requireRole('admin');
    return { ok: true, datos: await getRankingParaEvento(eventId) };
  } catch (e) {
    return fallo(e);
  }
}

/** Tiradores activos, para las plazas de criterio técnico. */
export async function cargarTiradores(): Promise<Cargado<AthletePicker[]>> {
  try {
    await requireRole('admin');
    return { ok: true, datos: await listAthletesForPicker() };
  } catch (e) {
    return fallo(e);
  }
}
