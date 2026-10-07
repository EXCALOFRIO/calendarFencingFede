import { ERROR_NO_AUTENTICADO, type ContextoExplorador } from './contexto';
import {
  cargarConteoSiguiendo,
  cargarSiguiendo,
  leerPropuestasParaSeguir,
  type FuentesPropuestas,
  type PersonaParaSeguir,
  type VistaSiguiendo,
} from './siguiendo-pantalla';
import { leerListaSiguiendo, type PersonaSeguida } from './siguiendo-lista';

/**
 * Cargadores de las tres pestañas de Explorar (Inicio, Buscar sin texto y
 * Siguiendo). Cada uno hace lo mínimo para su primera pintura: una consulta
 * para la lista y, sólo si sale vacía, lo que hace falta para explicar por qué.
 */

function esNoAutenticado(error: unknown): boolean {
  return error instanceof Error && error.message === ERROR_NO_AUTENTICADO;
}

function aviso(que: string, error: unknown) {
  console.error(`[explorar] ${que} no se pudo leer:`, error instanceof Error ? error.name : 'desconocido');
}

export type VistaInicio = {
  vista: VistaSiguiendo;
  /** Sólo se cuenta con la primera página vacía: distingue «no sigues a nadie» de «sin resultados». */
  siguiendo: number | null;
};

/** Inicio: el feed. El conteo sólo se pide si la primera página sale vacía. */
export async function cargarInicio(
  ctx: ContextoExplorador,
  criterios: { cursor?: string; soloMedallas?: boolean },
  fuentes?: FuentesPropuestas,
): Promise<VistaInicio> {
  const vista = await cargarSiguiendo(ctx, criterios, fuentes);
  const vacia = vista.tipo === 'ok' && vista.sinResultados && !criterios.cursor;
  return { vista, siguiendo: vacia ? await cargarConteoSiguiendo(ctx) : null };
}

export type VistaListaSiguiendo =
  | { tipo: 'sin_sesion' }
  | { tipo: 'cursor_invalido' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }
  | {
      tipo: 'ok';
      items: PersonaSeguida[];
      siguiente: string | null;
      /** Total de personas seguidas; `null` si no se pudo contar. */
      total: number | null;
      /** Sólo con la lista vacía; `null` = no se pudieron leer. */
      sugeridos?: PersonaParaSeguir[] | null;
    };

/**
 * Lista de seguidas. Con una sola página el total es su longitud y no hace
 * falta otra consulta; sólo una cuenta con más de una página pide el conteo.
 */
export async function cargarListaSiguiendo(
  ctx: ContextoExplorador,
  cursor: string | undefined,
  fuentes?: FuentesPropuestas,
): Promise<VistaListaSiguiendo> {
  try {
    const r = await leerListaSiguiendo(ctx, cursor ? { cursor } : {});
    if (r.estado === 'entrada_invalida') return { tipo: 'error' };
    if (r.estado !== 'ok') return { tipo: r.estado };
    const total = !cursor && !r.siguiente ? r.items.length : await cargarConteoSiguiendo(ctx);
    if (!r.sinResultados || cursor) return { tipo: 'ok', items: r.items, siguiente: r.siguiente, total };
    let sugeridos: PersonaParaSeguir[] | null;
    try {
      sugeridos = await leerPropuestasParaSeguir(ctx, fuentes);
    } catch (error) {
      if (esNoAutenticado(error)) throw error;
      aviso('las propuestas para seguir', error);
      sugeridos = null;
    }
    return { tipo: 'ok', items: [], siguiente: null, total, sugeridos };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    aviso('la lista de Siguiendo', error);
    return { tipo: 'error' };
  }
}

/** Buscar sin texto: sólo las propuestas para seguir (`null` si fallan; la búsqueda sigue funcionando). */
export async function cargarBuscarVacio(
  ctx: ContextoExplorador,
  fuentes?: FuentesPropuestas,
): Promise<PersonaParaSeguir[] | null> {
  try {
    return await leerPropuestasParaSeguir(ctx, fuentes);
  } catch (error) {
    if (esNoAutenticado(error)) throw error;
    aviso('las sugerencias para seguir', error);
    return null;
  }
}
