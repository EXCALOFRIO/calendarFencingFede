'use server';

import { requireProfile } from '@/lib/auth/session';
import type { EventView } from '@/lib/queries/calendar';
import { calendarioCompartido } from '@/lib/queries/calendario-cache';
import { idDeEventoValido } from '@/lib/queries/calendario-cache-modelo';
import type { VistaPodiosEvento } from '@/lib/queries/evento-resultados';
import { quienVaDelEvento, type QuienVa } from '@/lib/queries/quien-va';

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
  if (!idDeEventoValido(eventId)) return null;
  return calendarioCompartido.detalle(eventId);
}

export type FichaDelEvento = {
  /** `null` si no existe o no se pudo leer: la ficha se queda con lo del calendario. */
  detalle: EventView | null;
  /** `null` si la lista no se pudo leer (no es lo mismo que una lista vacía). */
  inscritos: QuienVa | null;
  /** Sólo si se pidió (torneo terminado); `'fallo'` si no se pudo leer. */
  podios: VistaPodiosEvento | 'fallo' | null;
};

/**
 * Todo lo que la ficha de un torneo pide al abrirse, en UNA acción.
 *
 * Next despacha las acciones de servidor de una en una, así que las tres que
 * pedía la ficha (detalle, quién va y podios) eran tres viajes en serie. Aquí
 * se leen en paralelo, lo común desde la caché compartida y lo de la cuenta
 * («es mío», pendientes de la dirección técnica) en la petición. El cliente la
 * lanza también al mostrar intención de abrir la ficha (`ficha/precarga.ts`).
 */
export async function fichaDelEvento(eventId: unknown, conPodios: unknown): Promise<FichaDelEvento> {
  const perfil = await requireProfile();
  if (!idDeEventoValido(eventId)) return { detalle: null, inscritos: null, podios: null };
  const [detalle, inscritos, podios] = await Promise.all([
    calendarioCompartido.detalle(eventId).catch(() => null),
    quienVaDelEvento(perfil, eventId, calendarioCompartido.listaPublica(eventId)).catch(() => null),
    conPodios === true
      ? calendarioCompartido.podios(eventId).catch(() => 'fallo' as const)
      : Promise.resolve(null),
  ]);
  return { detalle, inscritos, podios };
}
