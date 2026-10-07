'use server';

import type { ResultadosDeEvento } from '@/lib/sport/explorar/enlaces-calendario';
import { resultadosDeEventoCompartido } from '@/lib/sport/explorar/enlaces-calendario-real';
import { contextoReal } from '@/lib/sport/explorar/real';

/**
 * Ediciones y pruebas con resultados de un torneo del calendario, y adónde
 * lleva su botón «Resultados» (`enlaces-calendario.ts`). Invocable por
 * cualquiera: la guarda de sesión va dentro, antes de validar o leer nada, y
 * sin sesión responde `sin_sesion`. Recibe el torneo y nada más.
 */
export async function enlacesResultadosDelEvento(eventoId: unknown): Promise<ResultadosDeEvento> {
  return resultadosDeEventoCompartido(contextoReal(), eventoId);
}
