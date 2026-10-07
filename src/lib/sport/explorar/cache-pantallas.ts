import type { Cacheado, DefinicionCache } from '@/lib/cache/cache';
import type { ParteClave } from '@/lib/cache/claves';
import { cargarCaraACaraPantalla, type VistaCaraACara } from './cara-a-cara-pantalla';
import { CRITERIOS_CARA_A_CARA_VACIOS, rivalValido, type CriteriosCaraACara } from './cara-a-cara-url';
import { ERROR_NO_AUTENTICADO, exigirPerfil, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { cargarCatalogoEdiciones, type VistaCatalogo } from './catalogo';
import type { CriteriosEdicion } from './edicion-url';
import { cargarEdicion, cargarSeries, type VistaEdicion, type VistaSeries } from './ediciones-pantalla';
import { cargarBuscarVacio } from './inicio-pantalla';
import { cargarRelevosCaraACara, type RelevosCaraACara } from './relevos';
import { leerDestacadosParaSeguir, leerSugeridosDePersona, type PersonaParaSeguir } from './siguiendo-pantalla';

/**
 * Edición y cara a cara servidos desde la caché compartida.
 *
 * Lo que se guarda es común a todas las cuentas: la sesión se comprueba con
 * el contexto de la petición ANTES de entrar en la caché, y el cargador
 * calcula con `publico(hoy)`, que no lleva cuenta. Las claves son sólo
 * identificadores y filtros de la URL. Lo paginado con cursor va directo a D1:
 * es raro y el cursor no cabe en una clave.
 *
 * Sólo se guardan lecturas completas; un fallo parcial (los asaltos de una
 * prueba, la lista de rivales o el rendimiento) se sirve una vez y se vuelve a
 * pedir en la siguiente visita. Los relevos son la excepción (ver
 * `dueloGuardable`).
 */

const HORA = 3_600_000;
const DIA = 24 * HORA;
/** `deporte` cambia de versión con cada escritura en `sport_*`: esto es sólo la red de seguridad. */
const FRESCO = 6 * HORA;
const CADUCA = 7 * DIA;

type Definidor = {
  definir<P extends readonly ParteClave[], T>(def: DefinicionCache<P, T>): Cacheado<P, T>;
};

export type CaraACaraCompartida = { vista: VistaCaraACara; relevos: RelevosCaraACara | null };

const hoyIso = () => new Date().toISOString().slice(0, 10);

function registrar(que: string, error: unknown) {
  console.error(`[explorar] ${que}:`, error instanceof Error ? error.name : 'desconocido');
}

/** `null` si hay sesión vigente; si no, el estado que pinta la pantalla. */
async function guardaDeSesion(ctx: ContextoExplorador): Promise<{ tipo: 'sin_sesion' } | { tipo: 'error' } | null> {
  try {
    await exigirPerfil(ctx);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_NO_AUTENTICADO) return { tipo: 'sin_sesion' };
    registrar('la sesión no se pudo comprobar', error);
    return { tipo: 'error' };
  }
}

export function edicionGuardable(v: VistaEdicion): boolean {
  return v.tipo === 'ok' && v.edicion.asaltos !== 'error';
}

export function eleccionGuardable(v: VistaCaraACara): boolean {
  return v.tipo === 'elegir' && v.rivales.tipo === 'ok' && (v.otros === null || v.otros.tipo === 'ok');
}

/**
 * `relevos: null` sí se guarda: es lo que devuelven siempre una base sin las
 * tablas de relevos y una persona sin relevos, y la sección simplemente no sale.
 */
export function dueloGuardable(v: CaraACaraCompartida, conFiltros: boolean): boolean {
  if (v.vista.tipo !== 'ok') return false;
  // Sin filtros el rendimiento siempre se pide: `null` ahí es que falló.
  return conFiltros || Boolean(v.vista.rendimiento);
}

export function crearCachesExplorar({
  cache,
  publico,
}: {
  cache: Definidor;
  /** Contexto sin cuenta para los cargadores (`contextoPublico`). */
  publico: (hoy: string) => ContextoExplorador;
}) {
  const edicion = cache.definir({
    espacio: 'edicion-pantalla',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: (edicionId: string, prueba: string) =>
      cargarEdicion(publico(hoyIso()), edicionId, { prueba, cursor: '' }),
    guardarSi: edicionGuardable,
  });

  const eleccion = cache.definir({
    espacio: 'cara-a-cara-elegir',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    // `hoy` sólo con búsqueda por nombre: el año de nacimiento público depende del día.
    cargar: (personaId: string, q: string, hoy: string | null) =>
      cargarCaraACaraPantalla(publico(hoy ?? hoyIso()), personaId, { ...CRITERIOS_CARA_A_CARA_VACIOS, q }),
    guardarSi: eleccionGuardable,
  });

  // Lo que el cargador sabe incompleto; el valor guardado no lleva la marca.
  const incompletos = new WeakSet<object>();
  const duelo = cache.definir({
    espacio: 'cara-a-cara-duelo',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: async (personaId: string, rival: string, temporada: string, arma: string, fase: string, ambito: string) => {
      const ctx = publico(hoyIso());
      const criterios: CriteriosCaraACara = { ...CRITERIOS_CARA_A_CARA_VACIOS, rival, temporada, arma, fase, ambito };
      // Los relevos van en la misma entrada: la pantalla los pinta a la vez, sin un `Suspense` aparte.
      const [vista, relevos] = await Promise.all([
        cargarCaraACaraPantalla(ctx, personaId, criterios),
        cargarRelevosCaraACara(ctx, personaId, rival, criterios),
      ]);
      const valor: CaraACaraCompartida = { vista, relevos };
      if (!dueloGuardable(valor, Boolean(temporada || arma || fase || ambito))) incompletos.add(valor);
      return valor;
    },
    guardarSi: (v: CaraACaraCompartida) => !incompletos.has(v),
  });

  const series = cache.definir({
    espacio: 'ediciones-series',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: () => cargarSeries(publico(hoyIso())),
    guardarSi: (v: VistaSeries) => v.tipo === 'ok',
  });

  const catalogo = cache.definir({
    espacio: 'ediciones-catalogo',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: (q: string, fuente: string, temporada: string) =>
      cargarCatalogoEdiciones(publico(hoyIso()), {
        ...(q ? { q } : {}), ...(fuente ? { fuente } : {}), ...(temporada ? { temporada } : {}),
      }),
    guardarSi: (v: VistaCatalogo) => v.estado === 'ok',
  });

  // Propuestas de Buscar vacío: las dos listas comunes. Lo de la cuenta (su
  // ficha y a quién sigue) lo quita `leerPropuestasParaSeguir` al vuelo.
  const destacados = cache.definir({
    espacio: 'buscar-destacados',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: () => leerDestacadosParaSeguir(publico(hoyIso())),
  });

  const sugeridosDe = cache.definir({
    espacio: 'buscar-sugeridos',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: (personaId: string) => leerSugeridosDePersona(publico(hoyIso()), personaId),
  });

  /** Buscar sin texto: propuestas para seguir con las listas comunes de la caché. */
  function cargarBuscarVacioCompartido(ctx: ContextoExplorador): Promise<PersonaParaSeguir[] | null> {
    return cargarBuscarVacio(ctx, {
      destacados: () =>
        destacados().catch((error) => {
          registrar('la caché de destacados falló', error);
          return leerDestacadosParaSeguir(ctx);
        }),
      sugeridosDe: (personaId) =>
        sugeridosDe(personaId).catch((error) => {
          registrar('la caché de sugeridos falló', error);
          return leerSugeridosDePersona(ctx, personaId);
        }),
    });
  }

  /** Catálogo y series de `/explorar/ediciones`; con cursor (páginas siguientes), directo. */
  async function cargarCatalogoCompartido(
    ctx: ContextoExplorador,
    criterios: { q: string; fuente: string; temporada: string },
    cursor: string | undefined,
  ): Promise<{ series: VistaSeries; catalogo: VistaCatalogo }> {
    const guarda = await guardaDeSesion(ctx);
    if (guarda) return { series: guarda, catalogo: { estado: guarda.tipo } };
    const entrada = Object.fromEntries(Object.entries(criterios).filter(([, valor]) => valor));
    const directo = () => cargarCatalogoEdiciones(ctx, { ...entrada, ...(cursor ? { cursor } : {}) });
    const [s, c] = await Promise.all([
      series().catch(() => cargarSeries(ctx)),
      cursor ? directo() : catalogo(criterios.q, criterios.fuente, criterios.temporada).catch(directo),
    ]);
    return { series: s, catalogo: c };
  }

  /** La edición de la página `/explorar/ediciones/[id]` (con su prueba elegida). */
  async function cargarEdicionCompartida(
    ctx: ContextoExplorador,
    edicionId: string,
    criterios: CriteriosEdicion,
  ): Promise<VistaEdicion> {
    const guarda = await guardaDeSesion(ctx);
    if (guarda) return guarda;
    if (criterios.cursor) return cargarEdicion(ctx, edicionId, criterios);
    try {
      return await edicion(edicionId, criterios.prueba);
    } catch (error) {
      registrar('la caché de la edición falló', error);
      return cargarEdicion(ctx, edicionId, criterios);
    }
  }

  /** La pantalla de cara a cara: elegir rival o el duelo, con sus relevos. */
  async function cargarCaraACaraCompartida(
    ctx: ContextoExplorador,
    personaId: string,
    criterios: CriteriosCaraACara,
  ): Promise<CaraACaraCompartida> {
    const guarda = await guardaDeSesion(ctx);
    if (guarda) return { vista: guarda, relevos: null };
    if (!UUID_RE.test(personaId) || (criterios.rival && !rivalValido(criterios.rival))) {
      return { vista: { tipo: 'entrada_invalida' }, relevos: null };
    }
    const directo = async (): Promise<CaraACaraCompartida> => {
      const [vista, relevos] = await Promise.all([
        cargarCaraACaraPantalla(ctx, personaId, criterios),
        criterios.rival ? cargarRelevosCaraACara(ctx, personaId, criterios.rival, criterios) : Promise.resolve(null),
      ]);
      return { vista, relevos };
    };
    if (criterios.cursor) return directo();
    try {
      if (!criterios.rival) {
        return { vista: await eleccion(personaId, criterios.q, criterios.q ? ctx.hoy() : null), relevos: null };
      }
      const { temporada, arma, fase, ambito } = criterios;
      return await duelo(personaId, criterios.rival, temporada, arma, fase, ambito);
    } catch (error) {
      registrar('la caché del cara a cara falló', error);
      return directo();
    }
  }

  return { cargarEdicionCompartida, cargarCaraACaraCompartida, cargarCatalogoCompartido, cargarBuscarVacioCompartido };
}
