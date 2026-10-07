'use server';

import { requireProfile } from '@/lib/auth/session';
import { hoyMadrid } from '@/lib/callups/fechas';
import { calendarioCompartido } from '@/lib/queries/calendario-cache';
import type { TramoPasado } from '@/lib/queries/calendario-pasado-modelo';
import { MAXIMO_DIAS_TRAMO, tramoPasadoDe } from '@/lib/queries/calendario-pasado-tramo';
import { esFechaIsoReal } from '@/lib/utils';

/**
 * Lo ya celebrado de un tramo del calendario, para cuando se navega hacia
 * atrás. La carga normal de la pantalla trae de hoy en adelante; esto trae el
 * resto, tramo a tramo y solo el que se mira.
 *
 * Es invocable por cualquiera, así que valida lo que recibe: sesión antes de
 * nada, dos fechas ISO reales, en orden y a no más de un trimestre. El tramo se
 * recorta a ayer en el servidor, no en quien llama.
 */
export async function pasadoDelTramo(desde: unknown, hasta: unknown): Promise<TramoPasado | null> {
  await requireProfile();
  if (typeof desde !== 'string' || typeof hasta !== 'string') return null;
  if (!esFechaIsoReal(desde) || !esFechaIsoReal(hasta) || desde > hasta) return null;
  const dias = (Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000;
  if (dias > MAXIMO_DIAS_TRAMO) return null;

  const hoy = hoyMadrid();
  const tramo = tramoPasadoDe(desde, hasta, hoy);
  if (!tramo) return null;
  // Común a todas las cuentas: de la caché compartida (nacional e internacional).
  return calendarioCompartido.tramoPasado({ ...tramo, hoy });
}
