import { buscarDeportistas } from './busqueda';
import { leerCaraACara, listarRivales, type ResultadoCaraACara } from './cara-a-cara';
import {
  aEntradaCaraACara,
  aEntradaRivales,
  rivalValido,
  type CriteriosCaraACara,
} from './cara-a-cara-url';
import { ERROR_NO_AUTENTICADO, exigirPerfil, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { leerCabeceras, resolverPersona } from './personas';
import type { DeportistaResumen, RivalResumen } from './tipos';

/** Cuántas personas de la búsqueda por nombre se ofrecen aparte de los rivales confirmados. */
const OTROS_POR_BUSQUEDA = 8;

/**
 * Lista de rivales con asaltos confirmados. Es independiente de la persona y
 * de la búsqueda por nombre: si falla, el resto de la pantalla se pinta con
 * el aviso de que la lista no se pudo leer, en lugar de una lista vacía.
 */
export type RivalesVista =
  | { tipo: 'ok'; items: RivalResumen[]; siguiente: string | null; sinResultados: boolean }
  | { tipo: 'cursor_invalido' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' };

/** Personas que coinciden con el nombre, tengan o no asaltos importados con la consultada. */
export type OtrosVista = { tipo: 'ok'; items: DeportistaResumen[] } | { tipo: 'error' };

export type PersonaCaraACara = { id: string; nombre: string; pais: string | null };

export type DatosCaraACara = Extract<ResultadoCaraACara, { estado: 'ok' }>;

export type VistaCaraACara =
  | { tipo: 'sin_sesion' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'cursor_invalido' }
  | { tipo: 'no_encontrada' }
  | { tipo: 'no_disponible' }
  | { tipo: 'misma_persona' }
  | { tipo: 'error' }
  | { tipo: 'elegir'; persona: PersonaCaraACara; rivales: RivalesVista; otros: OtrosVista | null }
  | { tipo: 'ok'; datos: DatosCaraACara };

function esNoAutenticado(error: unknown): boolean {
  return error instanceof Error && error.message === ERROR_NO_AUTENTICADO;
}

function registrar(error: unknown, que: string): void {
  console.error(`[explorar] ${que}:`, error instanceof Error ? error.name : 'desconocido');
}

async function leerRivalesVista(
  ctx: ContextoExplorador,
  personaId: string,
  criterios: CriteriosCaraACara,
): Promise<RivalesVista> {
  try {
    const r = await listarRivales(ctx, aEntradaRivales(personaId, criterios));
    if (r.estado === 'ok') {
      return { tipo: 'ok', items: r.items, siguiente: r.siguiente, sinResultados: r.sinResultados };
    }
    // La persona ya se resolvió en paralelo: desaparecer entre lecturas es un fallo, no «sin rivales».
    return r.estado === 'no_encontrada' ? { tipo: 'error' } : { tipo: r.estado };
  } catch (error) {
    if (esNoAutenticado(error)) throw error;
    registrar(error, 'la lista de rivales no se pudo leer');
    return { tipo: 'error' };
  }
}

async function leerOtrosVista(
  ctx: ContextoExplorador,
  nombre: string,
): Promise<OtrosVista | null> {
  try {
    const r = await buscarDeportistas(ctx, { q: nombre, limite: OTROS_POR_BUSQUEDA });
    if (r.estado === 'ok') return { tipo: 'ok', items: r.items };
    // Un nombre demasiado corto no es una búsqueda: no hay nada que ofrecer, y tampoco es un fallo.
    return r.estado === 'sin_criterio' ? null : { tipo: 'error' };
  } catch (error) {
    if (esNoAutenticado(error)) throw error;
    registrar(error, 'la búsqueda de rivales por nombre no se pudo leer');
    return { tipo: 'error' };
  }
}

async function leerPersona(
  ctx: ContextoExplorador,
  personaId: string,
): Promise<PersonaCaraACara | null> {
  const resuelta = await resolverPersona(ctx.db, personaId);
  if (!resuelta) return null;
  const cabecera = (await leerCabeceras(ctx.db, [resuelta.canonicaId])).get(resuelta.canonicaId);
  return cabecera ? { id: cabecera.id, nombre: cabecera.nombre, pais: cabecera.pais } : null;
}

/**
 * Lectura de la pantalla de cara a cara de una persona. Con rival elegido es
 * el cara a cara; sin rival, la elección de rival (confirmados con asaltos y,
 * si se escribe un nombre, también el resto de personas indexadas, porque un
 * rival aún sin procesar tiene que poder abrirse para ver su cobertura).
 *
 * La guarda de sesión va antes de cualquier consulta, y cada estado de fallo
 * es distinto de «no hay asaltos».
 */
export async function cargarCaraACaraPantalla(
  ctx: ContextoExplorador,
  personaId: string,
  criterios: CriteriosCaraACara,
): Promise<VistaCaraACara> {
  try {
    await exigirPerfil(ctx);
    if (!UUID_RE.test(personaId)) return { tipo: 'entrada_invalida' };

    if (criterios.rival) {
      if (!rivalValido(criterios.rival)) return { tipo: 'entrada_invalida' };
      const r = await leerCaraACara(ctx, aEntradaCaraACara(personaId, criterios));
      return r.estado === 'ok' ? { tipo: 'ok', datos: r } : { tipo: r.estado };
    }

    if (!(await ctx.esquema()).identidad) return { tipo: 'no_disponible' };
    const buscarOtros = !criterios.cursor && criterios.q !== '';
    const [persona, rivales, otros] = await Promise.all([
      leerPersona(ctx, personaId),
      leerRivalesVista(ctx, personaId, criterios),
      buscarOtros ? leerOtrosVista(ctx, criterios.q) : Promise.resolve(null),
    ]);
    if (!persona) return { tipo: 'no_encontrada' };
    return { tipo: 'elegir', persona, rivales, otros };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    registrar(error, 'el cara a cara no se pudo leer');
    return { tipo: 'error' };
  }
}
