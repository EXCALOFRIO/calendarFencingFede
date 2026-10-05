import { buscarDeportistas } from './busqueda';
import { ERROR_NO_AUTENTICADO, type ContextoExplorador } from './contexto';
import { aEntrada, type CriteriosExplorar } from './url';
import type { DeportistaBuscado } from './tipos-busqueda';

/**
 * Lo que la pantalla Explorar sabe pintar. Cada estado es distinto de los
 * demás a propósito: «no se pudo consultar» y «consultado y sin coincidencias»
 * no deben parecerse nunca.
 */
export type VistaExplorar =
  | { tipo: 'sin_sesion' }
  | { tipo: 'sin_criterio' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'cursor_invalido' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }
  | {
      tipo: 'ok';
      items: DeportistaBuscado[];
      siguiente: string | null;
      sinResultados: boolean;
    };

/**
 * Lectura de la primera pantalla y de cada página siguiente. Sólo consulta
 * Neon a través de `buscarDeportistas` (que ya exige sesión antes de validar o
 * leer nada); un fallo inesperado se convierte en el estado `error` en lugar
 * de una lista vacía.
 */
export async function cargarExplorar(
  ctx: ContextoExplorador,
  criterios: CriteriosExplorar,
  cursor: string | undefined,
): Promise<VistaExplorar> {
  try {
    const r = await buscarDeportistas(ctx, aEntrada(criterios, cursor));
    if (r.estado === 'ok') {
      return {
        tipo: 'ok',
        items: r.items,
        siguiente: r.siguiente,
        sinResultados: r.sinResultados,
      };
    }
    return { tipo: r.estado };
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_NO_AUTENTICADO) {
      return { tipo: 'sin_sesion' };
    }
    console.error(
      '[explorar] la búsqueda no se pudo completar:',
      error instanceof Error ? error.name : 'desconocido',
    );
    return { tipo: 'error' };
  }
}
