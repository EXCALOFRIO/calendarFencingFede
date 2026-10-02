'use server';

import { cargarResultadosEvento, type VistaResultadosEvento } from '@/lib/sport/explorar/ediciones-pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';

/**
 * Ediciones deportivas y resultados de un torneo del calendario, para la banda
 * «Resultados» de su ficha. Es un endpoint invocable por cualquiera: la guarda
 * de sesión está dentro de la lectura, antes de validar o consultar nada, y sin
 * sesión responde `sin_sesion` sin tocar datos. La entrada es el torneo y nada
 * más; no recibe cuentas ni devuelve ranking interno.
 */
export async function resultadosDelEvento(eventoId: unknown): Promise<VistaResultadosEvento> {
  return cargarResultadosEvento(contextoReal(), eventoId);
}
