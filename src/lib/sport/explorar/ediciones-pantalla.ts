import { ERROR_NO_AUTENTICADO, type ContextoExplorador } from './contexto';
import type { EdicionDetalle, EdicionResumen, PruebaDeEdicion } from './edicion-modelo';
import type { CriteriosEdicion } from './edicion-url';
import { leerEdicion, leerEdicionesDeEvento, leerSeries, type ResultadoSeries } from './ediciones';

/**
 * Lo que saben pintar las páginas de edición y la banda de resultados del
 * calendario. Cada estado es distinto a propósito: «no se pudo leer» nunca se
 * parece a «sin edición vinculada» ni a «sin resultados».
 */

export type VistaSeries =
  | { tipo: 'sin_sesion' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }
  | { tipo: 'ok'; series: Extract<ResultadoSeries, { estado: 'ok' }>['series'] };

export type VistaEdicion =
  | { tipo: 'sin_sesion' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'cursor_invalido' }
  | { tipo: 'no_encontrada' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }
  | { tipo: 'ok'; edicion: EdicionDetalle };

export type VistaResultadosEvento =
  | { tipo: 'sin_sesion' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }
  | { tipo: 'ok'; ediciones: (EdicionResumen & { pruebasDetalle: PruebaDeEdicion[] })[] };

function esNoAutenticado(error: unknown): boolean {
  return error instanceof Error && error.message === ERROR_NO_AUTENTICADO;
}

function registrar(que: string, error: unknown) {
  console.error(`[explorar] ${que}:`, error instanceof Error ? error.name : 'desconocido');
}

export async function cargarSeries(ctx: ContextoExplorador): Promise<VistaSeries> {
  try {
    const r = await leerSeries(ctx);
    return r.estado === 'ok' ? { tipo: 'ok', series: r.series } : { tipo: r.estado };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    registrar('las series no se pudieron leer', error);
    return { tipo: 'error' };
  }
}

export async function cargarEdicion(
  ctx: ContextoExplorador,
  edicionId: string,
  criterios: CriteriosEdicion,
): Promise<VistaEdicion> {
  try {
    const r = await leerEdicion(ctx, {
      edicionId,
      ...(criterios.prueba ? { prueba: criterios.prueba } : {}),
      ...(criterios.cursor ? { cursor: criterios.cursor } : {}),
    });
    return r.estado === 'ok' ? { tipo: 'ok', edicion: r.edicion } : { tipo: r.estado };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    registrar('la edición no se pudo leer', error);
    return { tipo: 'error' };
  }
}

export async function cargarResultadosEvento(
  ctx: ContextoExplorador,
  eventoId: unknown,
): Promise<VistaResultadosEvento> {
  try {
    const r = await leerEdicionesDeEvento(ctx, { eventoId });
    return r.estado === 'ok' ? { tipo: 'ok', ediciones: r.ediciones } : { tipo: r.estado };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    registrar('los resultados del torneo no se pudieron leer', error);
    return { tipo: 'error' };
  }
}
