'use server';

import { requireProfile } from '@/lib/auth/session';
import { type EventView, getEvent } from '@/lib/queries/calendar';

/**
 * El detalle de un torneo, con lo que se sacó de sus PDFs.
 *
 * POR QUÉ HACE FALTA ESTO, QUE ES UN HALLAZGO Y NO UN CAPRICHO
 * -----------------------------------------------------------
 * `getEvent` existía, devolvía `datosExtraidos` y **no lo llamaba nadie**: la
 * pantalla del calendario carga la temporada entera con `listEvents`, que a
 * propósito NO pide lo extraído —son 250 eventos por carga y una consulta más
 * en la pantalla principal se paga en cada visita—, y la ficha se abría con
 * ese mismo objeto. Resultado: los 98 datos leídos de las convocatorias
 * estaban en la base, la ficha tenía los campos para pintarlos y nunca
 * llegaban. Se veía «Cuota no publicada» en un torneo cuyo dossier dice 100 €.
 *
 * Así que la ficha los pide **al abrirse**, igual que ya pedía quién va. Es el
 * mismo reparto de siempre: lo que se mira doscientas cincuenta veces va en la
 * carga de la pantalla, y lo que se mira una vez se pide cuando se mira.
 *
 * `requireProfile` no es decoración: una acción de servidor es una ruta, y sin
 * esta línea sería una ruta abierta que devuelve el calendario entero de un
 * torneo a quien no ha entrado.
 */
export async function detalleDelEvento(
  eventId: string,
): Promise<EventView | null> {
  await requireProfile();
  return getEvent(eventId);
}
