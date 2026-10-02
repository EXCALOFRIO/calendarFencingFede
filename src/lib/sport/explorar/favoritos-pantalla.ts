import { ERROR_NO_AUTENTICADO, type ContextoExplorador } from './contexto';
import { consultarFavorito, listarFavoritos, type FavoritoResumen } from './favoritos';

/**
 * Lo que sabe pintar la lista de favoritos y el control de la ficha. Cada
 * estado es distinto a propósito: «no se pudo leer» nunca se parece a «no hay
 * favoritos» ni a «no está guardado».
 */
export type VistaFavoritos =
  | { tipo: 'sin_sesion' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'cursor_invalido' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }
  | { tipo: 'ok'; items: FavoritoResumen[]; siguiente: string | null; sinResultados: boolean };

export type EstadoFavoritoVista =
  | { tipo: 'sin_sesion' }
  | { tipo: 'ok'; favorito: boolean; personaId: string }
  | { tipo: 'no_disponible' }
  | { tipo: 'no_encontrada' }
  | { tipo: 'error' };

function esNoAutenticado(error: unknown): boolean {
  return error instanceof Error && error.message === ERROR_NO_AUTENTICADO;
}

/**
 * Página de la lista propia. La cuenta sale de la sesión dentro de
 * `listarFavoritos`; la única entrada de la URL es el cursor, que además queda
 * ligado a esa cuenta.
 */
export async function cargarFavoritos(
  ctx: ContextoExplorador,
  cursor: string | undefined,
): Promise<VistaFavoritos> {
  try {
    const r = await listarFavoritos(ctx, cursor ? { cursor } : {});
    if (r.estado === 'ok') {
      return { tipo: 'ok', items: r.items, siguiente: r.siguiente, sinResultados: r.sinResultados };
    }
    return { tipo: r.estado };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    console.error(
      '[explorar] la lista de favoritos no se pudo leer:',
      error instanceof Error ? error.name : 'desconocido',
    );
    return { tipo: 'error' };
  }
}

/** Si la cuenta de la sesión tiene guardada a esa persona (o a su grupo fusionado). */
export async function cargarEstadoFavorito(
  ctx: ContextoExplorador,
  personaId: string,
): Promise<EstadoFavoritoVista> {
  try {
    const r = await consultarFavorito(ctx, { personaId });
    if (r.estado === 'ok') return { tipo: 'ok', favorito: r.favorito, personaId: r.personaId };
    if (r.estado === 'no_disponible' || r.estado === 'no_encontrada') return { tipo: r.estado };
    return { tipo: 'error' };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    console.error(
      '[explorar] el estado de favorito no se pudo leer:',
      error instanceof Error ? error.name : 'desconocido',
    );
    return { tipo: 'error' };
  }
}
