import type { Cacheado, DefinicionCache } from '@/lib/cache/cache';
import type { ParteClave } from '@/lib/cache/claves';
import { cargarCaraACaraPantalla, type VistaCaraACara } from './cara-a-cara-pantalla';
import { CRITERIOS_CARA_A_CARA_VACIOS, rivalValido, type CriteriosCaraACara } from './cara-a-cara-url';
import { ERROR_NO_AUTENTICADO, exigirPerfil, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { cargarCatalogoEdiciones, type VistaCatalogo } from './catalogo';
import type { CriteriosCatalogo } from './catalogo-url';
import { pruebaPreferida } from './edicion-modelo';
import type { CriteriosEdicion } from './edicion-url';
import { construirIndiceEdiciones, leerDatosIndiceEdiciones, type DatosIndiceEdiciones, type IndiceEdiciones } from './indice-ediciones';
import { cargarEdicion, cargarSeries, type VistaEdicion, type VistaSeries } from './ediciones-pantalla';
import { cargarBuscarVacio } from './inicio-pantalla';
import { cargarRelevosCaraACara, type RelevosCaraACara } from './relevos';
import { leerDestacadosParaSeguir, leerSugeridosDePersona, type FuentesPropuestas, type PersonaParaSeguir } from './siguiendo-pantalla';

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

// Lo que entra en una clave de caché viene de la URL: fuera de estos valores se lee directo,
// para que inventarse filtros no llene la caché de entradas que nadie más pedirá.
const TEMPORADA_RE = /^\d{4}(-\d{4})?$/;
const FUENTES_CATALOGO: readonly string[] = ['fie', 'efc', 'skermo_rfee', 'rfee_pdf', 'engarde'];
const ARMAS: readonly string[] = ['FLORETE', 'ESPADA', 'SABLE'];
const GENEROS: readonly string[] = ['M', 'F', 'MIXTO'];
const FORMATOS: readonly string[] = ['INDIVIDUAL', 'EQUIPOS'];
const FASES: readonly string[] = ['POULE', 'TABLEAU'];
const AMBITOS: readonly string[] = ['nacional', 'internacional'];
/** Texto libre más largo que esto (ya normalizado) no se cachea. */
export const MAX_Q_CACHE = 40;

const vacioO = (valor: string, valido: (v: string) => boolean) => valor === '' || valido(valor);

/** La misma normalización que aplica `leerCatalogoEdiciones`: dos textos que buscan lo mismo, una clave. */
export function qDeCatalogo(q: string): string | null {
  const n = q.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-,./]/g, ' ').replace(/\s+/g, ' ').trim();
  return n.length <= MAX_Q_CACHE ? n : null;
}

const CATEGORIA_RE = /^(M\d{1,2}|ABS|VET)$/;
const ANIO_RE = /^(19|20)\d{2}$/;

/** Catálogo sin el índice en memoria: sólo combinaciones válidas entran en una clave. */
export function criteriosCatalogoCacheables(c: Partial<CriteriosCatalogo> & { q: string; fuente: string; temporada: string }): CriteriosCatalogo | null {
  const q = qDeCatalogo(c.q);
  const { arma = '', categoria = '', desde = '', hasta = '', genero = '', formato = '' } = c;
  if (q === null || !vacioO(c.fuente, (f) => FUENTES_CATALOGO.includes(f)) || !vacioO(c.temporada, (t) => TEMPORADA_RE.test(t))
    || !vacioO(arma, (a) => ARMAS.includes(a)) || !vacioO(categoria, (x) => CATEGORIA_RE.test(x))
    || !vacioO(genero, (x) => GENEROS.includes(x)) || !vacioO(formato, (x) => FORMATOS.includes(x))
    || !vacioO(desde, (x) => ANIO_RE.test(x)) || !vacioO(hasta, (x) => ANIO_RE.test(x))) return null;
  return { q, fuente: c.fuente, temporada: c.temporada, arma, categoria, desde, hasta, genero, formato };
}

/**
 * Cuánto vive en el isolate el índice de ediciones ya construido antes de
 * volver a mirar la caché compartida (que es la que conoce la versión de los
 * datos): una búsqueda por tecla no deserializa ~1 MB cada vez.
 */
export const VIDA_INDICE_MS = 60_000;

export function filtrosDueloCacheables(c: { temporada: string; arma: string; fase: string; ambito: string }): boolean {
  return vacioO(c.temporada, (t) => TEMPORADA_RE.test(t)) && vacioO(c.arma, (a) => ARMAS.includes(a))
    && vacioO(c.fase, (f) => FASES.includes(f)) && vacioO(c.ambito, (a) => AMBITOS.includes(a));
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
    // `-2`: las rondas pasaron a «Semifinal», «Cuartos», «Octavos», «Tablón de N».
    espacio: 'edicion-pantalla-2',
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
    cargar: (q: string, fuente: string, temporada: string, arma: string, categoria: string, desde: string, hasta: string,
      genero: string, formato: string) =>
      cargarCatalogoEdiciones(publico(hoyIso()), Object.fromEntries(
        Object.entries({ q, fuente, temporada, arma, categoria, desde, hasta, genero, formato }).filter(([, v]) => v),
      )),
    guardarSi: (v: VistaCatalogo) => v.estado === 'ok',
  });

  // Los datos del índice de ediciones (públicos, sin cuenta): una lectura de D1 por versión.
  const datosIndice = cache.definir({
    espacio: 'ediciones-indice',
    depende: ['deporte'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: () => leerDatosIndiceEdiciones(publico(hoyIso())),
    guardarSi: (v: DatosIndiceEdiciones | null) => v !== null && v.v === 4,
  });

  let memoIndice: { indice: IndiceEdiciones | null; hasta: number } | null = null;
  let indiceEnVuelo: Promise<IndiceEdiciones | null> | null = null;

  /** El índice construido en este isolate; `null` si no se puede leer (se busca en D1). */
  function indiceEdiciones(): Promise<IndiceEdiciones | null> {
    if (memoIndice && memoIndice.hasta > Date.now()) return Promise.resolve(memoIndice.indice);
    indiceEnVuelo ??= datosIndice()
      .then((datos) => (datos && datos.v === 4 ? construirIndiceEdiciones(datos) : null))
      .catch((error) => {
        registrar('el índice de ediciones no se pudo leer', error);
        return null;
      })
      .then((indice) => {
        // Un fallo se recuerda poco: el siguiente intento llega pronto.
        memoIndice = { indice, hasta: Date.now() + (indice ? VIDA_INDICE_MS : 5_000) };
        indiceEnVuelo = null;
        return indice;
      });
    return indiceEnVuelo;
  }

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

  /** Las dos listas comunes de las propuestas para seguir, de la caché (Buscar vacío, feed y Siguiendo vacíos). */
  function fuentesPropuestasCompartidas(ctx: ContextoExplorador): FuentesPropuestas {
    return {
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
    };
  }

  /** Buscar sin texto: propuestas para seguir con las listas comunes de la caché. */
  function cargarBuscarVacioCompartido(ctx: ContextoExplorador): Promise<PersonaParaSeguir[] | null> {
    return cargarBuscarVacio(ctx, fuentesPropuestasCompartidas(ctx));
  }

  /**
   * Catálogo y series de `/explorar/ediciones`. Con el índice en memoria la
   * búsqueda se resuelve aquí mismo, sin D1 ni una entrada por texto en la
   * caché; sin él, la primera página de cada búsqueda sale de la caché y las
   * siguientes (con cursor) van directas.
   */
  async function cargarCatalogoCompartido(
    ctx: ContextoExplorador,
    criterios: Partial<CriteriosCatalogo> & { q: string; fuente: string; temporada: string },
    cursor: string | undefined,
    /** Armas de la cuenta: la fila de cada evento abre una edición de ellas. No entra en la caché. */
    opciones: { armasPreferidas?: readonly string[] } = {},
  ): Promise<{ series: VistaSeries; catalogo: VistaCatalogo }> {
    const guarda = await guardaDeSesion(ctx);
    if (guarda) return { series: guarda, catalogo: { estado: guarda.tipo } };
    const entrada = { ...Object.fromEntries(Object.entries(criterios).filter(([, valor]) => valor)), ...(cursor ? { cursor } : {}) };
    const conCatalogo = async (): Promise<VistaCatalogo> => {
      const indice = await indiceEdiciones();
      if (indice) {
        return cargarCatalogoEdiciones(ctx, entrada, { indice: async () => indice, armasPreferidas: opciones.armasPreferidas });
      }
      const directo = () => cargarCatalogoEdiciones(ctx, entrada);
      const clave = cursor ? null : criteriosCatalogoCacheables(criterios);
      return clave
        ? catalogo(clave.q, clave.fuente, clave.temporada, clave.arma, clave.categoria, clave.desde, clave.hasta,
          clave.genero, clave.formato).catch(directo)
        : directo();
    };
    const [s, c] = await Promise.all([series().catch(() => cargarSeries(ctx)), conCatalogo()]);
    return { series: s, catalogo: c };
  }

  /**
   * La edición de la página `/explorar/ediciones/[id]` (con su prueba elegida).
   * Sin `prueba=` en la dirección abre la de las armas de la cuenta, si la
   * edición tiene alguna (`pruebaPreferida`); si no, la de siempre.
   */
  async function cargarEdicionCompartida(
    ctx: ContextoExplorador,
    edicionId: string,
    criterios: CriteriosEdicion,
  ): Promise<VistaEdicion> {
    const guarda = await guardaDeSesion(ctx);
    if (guarda) return guarda;
    if (criterios.cursor) return cargarEdicion(ctx, edicionId, criterios);
    if (!UUID_RE.test(edicionId) || !vacioO(criterios.prueba, (p) => UUID_RE.test(p))) return cargarEdicion(ctx, edicionId, criterios);
    try {
      const vista = await edicion(edicionId, criterios.prueba);
      if (criterios.prueba || vista.tipo !== 'ok') return vista;
      // La entrada sin prueba es común a todos; la de las armas de la cuenta se
      // elige después, fuera de la caché, y se lee con su propia clave.
      const armas = (await ctx.perfil())?.weapons ?? [];
      const preferida = pruebaPreferida(vista.edicion.pruebasDetalle ?? [], { armas });
      return preferida && preferida.id !== vista.edicion.pruebaElegida ? await edicion(edicionId, preferida.id) : vista;
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
    // La búsqueda de rival por nombre es texto libre: no se cachea.
    if (!criterios.rival && criterios.q) return directo();
    if (criterios.rival && !filtrosDueloCacheables(criterios)) return directo();
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

  return {
    cargarEdicionCompartida, cargarCaraACaraCompartida, cargarCatalogoCompartido, cargarBuscarVacioCompartido, fuentesPropuestasCompartidas,
    indiceEdiciones,
  };
}
