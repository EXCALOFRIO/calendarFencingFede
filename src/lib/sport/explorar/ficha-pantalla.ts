import { ERROR_NO_AUTENTICADO, type ContextoExplorador } from './contexto';
import { leerFicha, leerHistorial, type ResultadoFicha } from './ficha';
import { aEntradaFicha, type CriteriosFicha } from './ficha-url';
import type { FichaDeportiva, ResultadoHistorial } from './tipos';

/**
 * Historial de la ficha. Es independiente de la ficha: si falla, la ficha se
 * sigue pintando con el aviso de que el historial no se pudo leer, en lugar de
 * mostrar un historial vacío.
 */
export type HistorialVista =
  | { tipo: 'ok'; items: ResultadoHistorial[]; siguiente: string | null; sinResultados: boolean }
  | { tipo: 'cursor_invalido' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' };

export type VistaFicha =
  | { tipo: 'sin_sesion' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'no_encontrada' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }
  /** Pidió su propia ficha y la cuenta no tiene una persona deportiva confirmada. */
  | { tipo: 'propia_no_confirmada'; motivo: Extract<ResultadoFicha, { estado: 'propia_no_confirmada' }>['motivo'] }
  | { tipo: 'ok'; ficha: FichaDeportiva; historial: HistorialVista };

function esNoAutenticado(error: unknown): boolean {
  return error instanceof Error && error.message === ERROR_NO_AUTENTICADO;
}

async function leerHistorialVista(
  ctx: ContextoExplorador,
  personaId: string,
  cursor: string,
): Promise<HistorialVista> {
  try {
    const r = await leerHistorial(ctx, cursor ? { personaId, cursor } : { personaId });
    if (r.estado === 'ok') {
      return { tipo: 'ok', items: r.items, siguiente: r.siguiente, sinResultados: r.sinResultados };
    }
    // Una persona que desaparece entre las dos lecturas no es «sin historial».
    return r.estado === 'no_encontrada' ? { tipo: 'error' } : { tipo: r.estado };
  } catch (error) {
    if (esNoAutenticado(error)) throw error;
    console.error(
      '[explorar] el historial no se pudo leer:',
      error instanceof Error ? error.name : 'desconocido',
    );
    return { tipo: 'error' };
  }
}

/**
 * Lectura de una ficha deportiva con su primera página de historial. Con
 * `personaId` abre exactamente esa persona (dos homónimos nunca se mezclan);
 * sin él abre la de la cuenta, sólo si está confirmada. Nada aquí devuelve
 * datos de la cuenta: ni para la propia ficha, que se pinta junto a esos datos
 * en otra sección de `/perfil`.
 */
export async function cargarFichaPantalla(
  ctx: ContextoExplorador,
  personaId: string | undefined,
  criterios: CriteriosFicha,
): Promise<VistaFicha> {
  try {
    // Con persona pedida, ficha e historial no dependen entre sí.
    const adelantado = personaId
      ? leerHistorialVista(ctx, personaId, criterios.cursor)
      : null;
    // Si la ficha falla primero, esta promesa no queda sin manejador.
    adelantado?.catch(() => undefined);
    const lectura = await leerFicha(ctx, aEntradaFicha(personaId, criterios));
    if (lectura.estado === 'propia_no_confirmada') {
      return { tipo: 'propia_no_confirmada', motivo: lectura.motivo };
    }
    if (lectura.estado !== 'ok') return { tipo: lectura.estado };
    const historial = await (adelantado ?? leerHistorialVista(ctx, lectura.ficha.id, criterios.cursor));
    return { tipo: 'ok', ficha: lectura.ficha, historial };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    console.error(
      '[explorar] la ficha no se pudo leer:',
      error instanceof Error ? error.name : 'desconocido',
    );
    return { tipo: 'error' };
  }
}
