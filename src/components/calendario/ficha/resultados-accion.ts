'use server';

import { edicionesExplorarDeEvento } from '@/lib/queries/calendario-pasado';
import { cargarPodiosEvento, type VistaPodiosEvento } from '@/lib/queries/evento-resultados';
import { contextoReal } from '@/lib/sport/explorar/real';

async function edicionesPorClave(eventoId: string): Promise<string[]> {
  return (await edicionesExplorarDeEvento(eventoId)).map((e) => e.edicionId);
}

/**
 * Resultados y podio de un torneo ya terminado, para su ficha. Es una ruta
 * invocable por cualquiera: la guarda de sesión va dentro de la lectura, antes
 * de validar o consultar nada, y sin sesión responde `sin_sesion`. Recibe el
 * torneo y nada más.
 */
export async function podiosDelEvento(eventoId: unknown): Promise<VistaPodiosEvento> {
  return cargarPodiosEvento(contextoReal(), eventoId, edicionesPorClave);
}
