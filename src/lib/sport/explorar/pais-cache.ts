import type { Cacheado, DefinicionCache } from '@/lib/cache/cache';
import type { ParteClave } from '@/lib/cache/claves';
import { ERROR_NO_AUTENTICADO, exigirPerfil, type ContextoExplorador } from './contexto';
import { esTablaAusente, leerDueloPaises, leerEstadoPaises, leerFichaPais, type DueloPaises, type FichaPais } from './pais';
import { esCodigoPais } from './pais-codigos';
import type { FiltrosDuelo, FiltrosPais } from './pais-url';

/**
 * Fichas de país servidas desde la caché compartida, con las reglas de
 * `cache-pantallas.ts`: la sesión se comprueba con el contexto de la petición
 * ANTES de entrar en la caché, el cargador lee con el contexto público (sin
 * cuenta) y las claves son sólo el país y los filtros ya validados de la URL.
 * La página siguiente de la lista de pruebas (con cursor) va directa a D1.
 *
 * La marca de la última reconstrucción de los agregados va en la clave: los
 * agregados no son `sport_*`, así que reconstruirlos no cambia la versión
 * `deporte`. Esa marca se lee una vez por minuto y base (`leerEstadoPaises`).
 */

const HORA = 3_600_000;
const FRESCO = 6 * HORA;
const CADUCA = 7 * 24 * HORA;

type Definidor = {
  definir<P extends readonly ParteClave[], T>(def: DefinicionCache<P, T>): Cacheado<P, T>;
};

export type VistaPais<T> =
  | { tipo: 'ok'; datos: T }
  | { tipo: 'sin_datos' }
  | { tipo: 'no_existe' }
  | { tipo: 'sin_sesion' }
  | { tipo: 'error' };

function registrar(que: string, error: unknown) {
  console.error(`[explorar] ${que}:`, error instanceof Error ? error.name : 'desconocido');
}

async function guarda(ctx: ContextoExplorador): Promise<{ tipo: 'sin_sesion' } | { tipo: 'error' } | null> {
  try {
    await exigirPerfil(ctx);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_NO_AUTENTICADO) return { tipo: 'sin_sesion' };
    registrar('la sesión no se pudo comprobar', error);
    return { tipo: 'error' };
  }
}

async function leerSeguro<T>(leer: () => Promise<T>, que: string): Promise<VistaPais<T>> {
  try {
    return { tipo: 'ok', datos: await leer() };
  } catch (error) {
    if (esTablaAusente(error)) return { tipo: 'sin_datos' };
    registrar(que, error);
    return { tipo: 'error' };
  }
}

export function crearCachesPais({
  cache,
  publico,
}: {
  cache: Definidor;
  /** Contexto sin cuenta para los cargadores (`contextoPublico`). */
  publico: (hoy: string) => ContextoExplorador;
}) {
  const hoy = () => new Date().toISOString().slice(0, 10);

  const ficha = cache.definir({
    espacio: 'pais-ficha',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    // `marca` sólo cambia la clave: es la reconstrucción de la que salen los datos.
    cargar: (codigo: string, arma: string, genero: string, categoria: string, modalidad: string, _marca: number) =>
      leerSeguro(() => leerFichaPais(publico(hoy()).db, codigo, { arma, genero, categoria, modalidad } as FiltrosPais), 'ficha de país'),
    guardarSi: (v: VistaPais<FichaPais>) => v.tipo === 'ok',
  });

  const duelo = cache.definir({
    espacio: 'pais-duelo',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: (codigo: string, rival: string, arma: string, genero: string, categoria: string, modalidad: string, temporada: string, _marca: number) =>
      leerSeguro(() => leerDueloPaises(publico(hoy()).db, codigo, rival,
        { arma, genero, categoria, modalidad, temporada } as FiltrosDuelo), 'cara a cara de países'),
    guardarSi: (v: VistaPais<DueloPaises>) => v.tipo === 'ok',
  });

  async function marca(ctx: ContextoExplorador): Promise<number | null> {
    const estado = await leerEstadoPaises(ctx.db);
    return estado ? estado.construidoEn : null;
  }

  /** Ficha de `/explorar/pais/[codigo]`. */
  async function cargarFichaPaisCompartida(ctx: ContextoExplorador, codigo: string, f: FiltrosPais): Promise<VistaPais<FichaPais>> {
    const sin = await guarda(ctx);
    if (sin) return sin;
    if (!esCodigoPais(codigo)) return { tipo: 'no_existe' };
    try {
      const m = await marca(ctx);
      if (m === null) return { tipo: 'sin_datos' };
      return await ficha(codigo, f.arma, f.genero, f.categoria, f.modalidad, m);
    } catch (error) {
      registrar('la caché de la ficha de país falló', error);
      return leerSeguro(() => leerFichaPais(ctx.db, codigo, f), 'ficha de país');
    }
  }

  /** Cara a cara de `/explorar/pais/[codigo]/contra/[otro]`; con cursor, directo. */
  async function cargarDueloPaisesCompartido(
    ctx: ContextoExplorador,
    codigo: string,
    rival: string,
    f: FiltrosDuelo,
    desde: string,
  ): Promise<VistaPais<DueloPaises>> {
    const sin = await guarda(ctx);
    if (sin) return sin;
    if (!esCodigoPais(codigo) || !esCodigoPais(rival) || codigo === rival) return { tipo: 'no_existe' };
    const directo = () => leerSeguro(() => leerDueloPaises(ctx.db, codigo, rival, f, desde), 'cara a cara de países');
    if (desde) return directo();
    try {
      const m = await marca(ctx);
      if (m === null) return { tipo: 'sin_datos' };
      return await duelo(codigo, rival, f.arma, f.genero, f.categoria, f.modalidad, f.temporada, m);
    } catch (error) {
      registrar('la caché del cara a cara de países falló', error);
      return directo();
    }
  }

  return { cargarFichaPaisCompartida, cargarDueloPaisesCompartido };
}
