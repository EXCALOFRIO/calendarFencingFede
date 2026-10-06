import { buscarDeportistas } from './busqueda';
import { ERROR_NO_AUTENTICADO, type ContextoExplorador } from './contexto';
import { seguidasEntre } from './seguidos';
import { aEntrada, type CriteriosExplorar } from './url';
import type { DeportistaBuscado } from './tipos-busqueda';

/**
 * Persona de la lista completa. `seguida` falta si no se pudo leer: entonces
 * la fila no ofrece «Seguir» en lugar de inventar «no la sigues».
 */
export type DeportistaListado = DeportistaBuscado & { seguida?: boolean };

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
      items: DeportistaListado[];
      siguiente: string | null;
      sinResultados: boolean;
    };

async function marcarSeguidas(ctx: ContextoExplorador, items: DeportistaBuscado[]): Promise<DeportistaListado[]> {
  try {
    const seguidas = await seguidasEntre(ctx, items.map((d) => d.id));
    return items.map((d) => ({ ...d, seguida: seguidas.has(d.id) }));
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_NO_AUTENTICADO) throw error;
    console.error('[explorar] las personas seguidas de la lista no se pudieron leer:', error instanceof Error ? error.name : 'desconocido');
    return items;
  }
}

/**
 * Una página de la búsqueda a partir de la entrada de `buscarDeportistas`
 * (criterios y cursor). Sirve a la primera pantalla y a «Ver más», que añade
 * la página siguiente sin navegar. Sólo consulta lo ya indexado a través de
 * `buscarDeportistas` (que exige sesión antes de validar o leer nada); un
 * fallo inesperado se convierte en el estado `error` en lugar de una lista
 * vacía.
 */
export async function cargarPaginaExplorar(ctx: ContextoExplorador, entrada: unknown): Promise<VistaExplorar> {
  try {
    const r = await buscarDeportistas(ctx, entrada);
    if (r.estado === 'ok') {
      return {
        tipo: 'ok',
        items: await marcarSeguidas(ctx, r.items),
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

/** Lectura de la primera pantalla y de cada página siguiente abierta por URL. */
export async function cargarExplorar(
  ctx: ContextoExplorador,
  criterios: CriteriosExplorar,
  cursor: string | undefined,
): Promise<VistaExplorar> {
  return cargarPaginaExplorar(ctx, aEntrada(criterios, cursor));
}
