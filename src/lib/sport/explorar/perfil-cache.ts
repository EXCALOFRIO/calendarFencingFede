import type { Cacheado, DefinicionCache } from '@/lib/cache/cache';
import type { ParteClave } from '@/lib/cache/claves';
import { ERROR_NO_AUTENTICADO, exigirPerfil, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { cargarFichaPantalla, type VistaFicha } from './ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from './ficha-url';
import {
  cargarCuriosidadesPerfil,
  cargarEuropeoPerfil,
  cargarRelevosPerfil,
  cargarRendimientoPerfil,
  cargarRivalesPerfil,
  type RivalesSeccion,
} from './perfil-diferido';
import { cargarExtrasPerfil, EXTRAS_VACIOS, type ExtrasPerfil } from './perfil-extra';
import { leerCabeceras } from './personas';
import { resolverPersonaPropia } from './propietario';
import type { BloqueRankingInternacional } from './ranking-internacional';
import type { RelevosPerfil } from './relevos';
import type { Rendimiento } from './rendimiento';
import type { EstadisticasRivales } from './tipos-social';

/**
 * Perfil público servido desde la caché compartida: la cabecera (ficha con la
 * primera página del historial y los extras) y cada sección por separado,
 * porque cada pestaña es una página y sólo pide lo suyo.
 *
 * Lo guardado es común a todas las cuentas. La sesión se comprueba con el
 * contexto de la petición ANTES de entrar en la caché, y los cargadores
 * calculan con un contexto sin cuenta (`publico`). Lo único de la cuenta que
 * cambia la ficha es si es la propia (`esPropia`, y con ella el año de
 * nacimiento que se le enseña a un menor): se resuelve en la petición y se
 * aplica encima. Seguir (favorito) va aparte, en el layout.
 *
 * Las claves son el identificador de la URL y, en la cabecera, el día: la
 * edad y el veto de menores dependen de él. La paginación del historial
 * (`cursor`) va directa a D1.
 */

const HORA = 3_600_000;
const DIA = 24 * HORA;
/** `deporte` cambia con cada escritura en `sport_*`; el tiempo es sólo la red de seguridad. */
const FRESCO = 6 * HORA;
const CADUCA = 7 * DIA;

type Definidor = {
  definir<P extends readonly ParteClave[], T>(def: DefinicionCache<P, T>): Cacheado<P, T>;
};

export type CabeceraCompartida = { vista: VistaFicha; extras: ExtrasPerfil };
export type RivalesCompartidos = { datos: RivalesSeccion; relevos: RelevosPerfil | null };

const RIVALES_VACIOS: RivalesCompartidos = { datos: { nombre: null, enfrentados: null, sugeridos: null }, relevos: null };

function registrar(que: string, error: unknown) {
  console.error(`[perfil] ${que}:`, error instanceof Error ? error.name : 'desconocido');
}

type Guarda = 'sin_sesion' | 'error' | null;

async function guardaDeSesion(ctx: ContextoExplorador): Promise<Guarda> {
  try {
    await exigirPerfil(ctx);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_NO_AUTENTICADO) return 'sin_sesion';
    registrar('la sesión no se pudo comprobar', error);
    return 'error';
  }
}

/** Sólo una lectura completa: un historial o unos extras fallidos se vuelven a pedir en la siguiente visita. */
export function cabeceraGuardable(v: CabeceraCompartida): boolean {
  return v.vista.tipo === 'ok' && v.vista.historial.tipo === 'ok' && v.extras !== EXTRAS_VACIOS;
}

export function rivalesGuardables(v: RivalesCompartidos): boolean {
  return v.datos.nombre !== null && v.datos.enfrentados !== null && v.datos.sugeridos !== null;
}

/**
 * La ficha de la caché es la de cualquiera que mira. Si es la de la cuenta,
 * se marca como propia y recupera el año de nacimiento que el veto de menores
 * quita a los demás.
 */
async function conPropiedad(ctx: ContextoExplorador, vista: VistaFicha, propiaDeCuenta: Promise<string | null>): Promise<VistaFicha> {
  if (vista.tipo !== 'ok') return vista;
  const propia = (await propiaDeCuenta) === vista.ficha.id;
  if (!propia) return vista;
  let anio = vista.ficha.anioNacimiento;
  if (anio === null) {
    anio = (await leerCabeceras(ctx.db, [vista.ficha.id], { sinFiltrar: true }).catch(() => null))?.get(vista.ficha.id)?.anioNacimiento ?? null;
  }
  return { ...vista, ficha: { ...vista.ficha, esPropia: true, anioNacimiento: anio } };
}

/** La persona confirmada de la cuenta que mira; `null` si no tiene o no se pudo resolver. Nunca se rechaza. */
async function personaDeCuenta(ctx: ContextoExplorador): Promise<string | null> {
  try {
    const perfil = await exigirPerfil(ctx);
    const r = await resolverPersonaPropia(ctx, perfil.profileId);
    return r.estado === 'confirmada' ? r.personaId : null;
  } catch (error) {
    if (!(error instanceof Error && error.message === ERROR_NO_AUTENTICADO)) {
      registrar('la propiedad de la ficha no se pudo resolver', error);
    }
    return null;
  }
}

export function crearCachesPerfil({
  cache,
  publico,
}: {
  cache: Definidor;
  /** Contexto sin cuenta para los cargadores (ver `perfil-cache-real.ts`). */
  publico: (hoy: string) => ContextoExplorador;
}) {
  const hoyIso = () => new Date().toISOString().slice(0, 10);

  const cabecera = cache.definir({
    espacio: 'perfil-cabecera',
    depende: ['deporte', 'ranking', 'ranking-fie'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: async (personaId: string, hoy: string): Promise<CabeceraCompartida> => {
      const ctx = publico(hoy);
      const [vista, extras] = await Promise.all([
        cargarFichaPantalla(ctx, personaId, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
        cargarExtrasPerfil(ctx, personaId, { conRendimiento: false }).catch(() => EXTRAS_VACIOS),
      ]);
      return { vista, extras };
    },
    guardarSi: cabeceraGuardable,
  });

  const rendimiento = cache.definir({
    espacio: 'perfil-rendimiento',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: (personaId: string) => cargarRendimientoPerfil(publico(hoyIso()), personaId),
  });

  const rivales = cache.definir({
    espacio: 'perfil-rivales',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: async (personaId: string): Promise<RivalesCompartidos> => {
      const ctx = publico(hoyIso());
      const [datos, relevos] = await Promise.all([cargarRivalesPerfil(ctx, personaId), cargarRelevosPerfil(ctx, personaId)]);
      return { datos, relevos };
    },
    guardarSi: rivalesGuardables,
  });

  const curiosidades = cache.definir({
    espacio: 'perfil-curiosidades',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: (personaId: string) => cargarCuriosidadesPerfil(publico(hoyIso()), personaId),
  });

  // `null` también se guarda: es lo que tiene casi todo el mundo (nada en el ranking europeo).
  const europeo = cache.definir({
    espacio: 'perfil-europeo',
    depende: ['deporte', 'ranking', 'ranking-fie'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: async (personaId: string) => ({ europeo: await cargarEuropeoPerfil(publico(hoyIso()), personaId) }),
  });

  /** Ficha, historial y extras de la cabecera; la propiedad, de la cuenta que mira. */
  async function cargarCabeceraPerfil(ctx: ContextoExplorador, personaId: string): Promise<CabeceraCompartida> {
    const guarda = await guardaDeSesion(ctx);
    if (guarda) return { vista: { tipo: guarda }, extras: EXTRAS_VACIOS };
    if (!UUID_RE.test(personaId)) return { vista: { tipo: 'entrada_invalida' }, extras: EXTRAS_VACIOS };
    // La propiedad sólo depende de la cuenta: se resuelve mientras se lee la
    // caché (o se calcula la cabecera en frío), no después.
    const propia = personaDeCuenta(ctx);
    let leida: CabeceraCompartida;
    try {
      leida = await cabecera(personaId, ctx.hoy());
    } catch (error) {
      registrar('la caché de la cabecera falló', error);
      const [vista, extras] = await Promise.all([
        cargarFichaPantalla(ctx, personaId, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
        cargarExtrasPerfil(ctx, personaId, { conRendimiento: false }).catch(() => EXTRAS_VACIOS),
      ]);
      return { vista, extras };
    }
    return { vista: await conPropiedad(ctx, leida.vista, propia), extras: leida.extras };
  }

  /** Una sección: la guarda de sesión, la caché y, si la caché falla, D1 directo. */
  function seccion<T>(
    nombre: string,
    vacio: T,
    deCache: (personaId: string) => Promise<T>,
    directo: (ctx: ContextoExplorador, personaId: string) => Promise<T>,
  ) {
    return async (ctx: ContextoExplorador, personaId: string): Promise<T> => {
      if ((await guardaDeSesion(ctx)) || !UUID_RE.test(personaId)) return vacio;
      try {
        return await deCache(personaId);
      } catch (error) {
        registrar(`la caché de ${nombre} falló`, error);
        return directo(ctx, personaId);
      }
    };
  }

  return {
    cargarCabeceraPerfil,
    cargarRendimientoCompartido: seccion<Rendimiento | null>('rendimiento', null, rendimiento, cargarRendimientoPerfil),
    cargarRivalesCompartidos: seccion<RivalesCompartidos>('rivales', RIVALES_VACIOS, rivales, async (ctx, id) => {
      const [datos, relevos] = await Promise.all([cargarRivalesPerfil(ctx, id), cargarRelevosPerfil(ctx, id)]);
      return { datos, relevos };
    }),
    cargarCuriosidadesCompartidas: seccion<EstadisticasRivales | null>('curiosidades', null, curiosidades, cargarCuriosidadesPerfil),
    cargarEuropeoCompartido: seccion<BloqueRankingInternacional | null>(
      'europeo',
      null,
      async (id) => (await europeo(id)).europeo,
      cargarEuropeoPerfil,
    ),
  };
}
