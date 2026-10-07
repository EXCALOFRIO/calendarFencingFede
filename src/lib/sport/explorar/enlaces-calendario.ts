import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { Cacheado, DefinicionCache } from '@/lib/cache/cache';
import type { ParteClave } from '@/lib/cache/claves';
import { construirUrlCalendario, leerContextoCalendario, sanitizarRetornoCalendario } from '@/lib/calendario/contexto-url';
import type { EdicionDeEvento, PruebaPasada } from '@/lib/queries/calendario-pasado-modelo';
import { ERROR_NO_AUTENTICADO, exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { construirUrlEdicion } from './edicion-url';

/**
 * ===========================================================================
 * CALENDARIO ↔ RESULTADOS
 * ===========================================================================
 *
 * Un torneo del calendario (`event`) y sus pruebas (`event_competition`) son,
 * en Explorar, una o varias ediciones (`sport_edition`) con sus pruebas
 * (`sport_competition`). Aquí están los dos sentidos del puente:
 *
 *  - del calendario a los resultados: las ediciones y pruebas con puestos de un
 *    torneo, para el botón «Resultados» de una competición terminada;
 *  - de los resultados al calendario: el torneo de una edición, para volver a
 *    su ficha (información, documentos, inscritos).
 *
 * Los dos usan las mismas claves exactas que el calendario (vínculo guardado,
 * clave de la FIE y clave de Skermo; ver `crucesExactos` en
 * `calendario-pasado.ts`) y nunca emparejan por parecido. Cada lectura es UNA
 * consulta por índice y sale de la caché compartida: no depende de quién mira
 * y no lleva datos de cuenta. La guarda de sesión va antes de la caché.
 */

/** Una prueba del calendario, tal y como la tiene la tarjeta (`CompetitionView`). */
export type CompeticionCalendario = {
  /** `event_competition.id`. */
  id?: string;
  weapon: string;
  gender: string;
  category: string;
  format: string;
};

/** Adónde lleva «Resultados»: la edición y, si se sabe, la prueba exacta. */
export type DestinoResultados = { edicionId: string; pruebaId: string | null };

export type ResultadosDeEvento =
  | { tipo: 'sin_sesion' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'error' }
  | {
      tipo: 'ok';
      /** Sólo ediciones con alguna prueba con puestos, y en ellas sólo esas pruebas. */
      ediciones: EdicionDeEvento[];
      /** Destino único del torneo entero; `null` si hay varias ediciones (se elige en una lista) o ninguna. */
      destino: DestinoResultados | null;
    };

/** El torneo del calendario de una edición: la tarjeta que se pinta, no un registro absorbido. */
export type EventoDeEdicion = { id: string; nombre: string; inicio: string; fin: string };

/* --------------------------------------------------------------- lógica pura */

export function soloConResultados(ediciones: readonly EdicionDeEvento[]): EdicionDeEvento[] {
  return ediciones
    .map((e) => ({ ...e, pruebas: e.pruebas.filter((p) => p.conResultados) }))
    .filter((e) => e.pruebas.length > 0);
}

/**
 * Con una sola edición detrás, «Resultados» va a ella (y a su prueba, si sólo
 * hay una). Con varias, la persona elige: la FIE publica una edición por
 * prueba, así que una Copa del Mundo con individual y equipos son dos.
 */
export function destinoDeEvento(ediciones: readonly EdicionDeEvento[]): DestinoResultados | null {
  const conPuestos = soloConResultados(ediciones);
  if (conPuestos.length !== 1) return null;
  const [unica] = conPuestos;
  return { edicionId: unica.edicionId, pruebaId: unica.pruebas.length === 1 ? unica.pruebas[0].id : null };
}

const claveDe = (p: { arma: string; genero: string; categoria: string; formato: string }) =>
  `${p.arma}|${p.genero}|${p.categoria}|${p.formato}`;

/**
 * La prueba de Explorar que ES esta prueba del calendario: mismo arma, género,
 * categoría y formato entre las del torneo (que ya vienen atadas por clave
 * exacta). Si dos ediciones la traen (la FIE y Skermo), gana la primera en el
 * orden de `edicionesDeCruces`, que pone delante la fuente con más datos.
 */
export function destinoDeCompeticion(
  competicion: CompeticionCalendario,
  ediciones: readonly EdicionDeEvento[],
): DestinoResultados | null {
  return destinoEnPruebas(competicion, ediciones.flatMap((e) => e.pruebas));
}

/** Lo mismo con la lista plana que ya tiene la tarjeta del calendario (`PasadoDeTarjeta.resultados[evento]`). */
export function destinoEnPruebas(competicion: CompeticionCalendario, pruebas: readonly PruebaPasada[]): DestinoResultados | null {
  const buscada = claveDe({ arma: competicion.weapon, genero: competicion.gender, categoria: competicion.category, formato: competicion.format });
  const p = pruebas.find((x) => x.conResultados && claveDe(x) === buscada);
  return p ? { edicionId: p.edicionId, pruebaId: p.id } : null;
}

/** Dirección de los resultados; `retorno` es el calendario tal y como se miraba. */
export function urlResultados(destino: DestinoResultados, retorno?: string): string {
  return construirUrlEdicion(destino.edicionId, {
    ...(destino.pruebaId ? { prueba: destino.pruebaId } : {}),
    ...(retorno ? { origen: retorno } : {}),
  });
}

/**
 * Dirección del calendario abierto en el mes del torneo y con su ficha
 * (`evento=`). Si se llegó desde el calendario (`origen`), conserva sus
 * filtros y su vista. La clave `evento` va aparte de `construirUrlCalendario`,
 * que sólo escribe el contexto que recuerda el calendario.
 */
export function urlEventoCalendario(evento: Pick<EventoDeEdicion, 'id' | 'inicio'>, origen?: string): string | null {
  if (!UUID_RE.test(evento.id)) return null;
  const retorno = sanitizarRetornoCalendario(origen);
  const previo = retorno.includes('?') ? Object.fromEntries(new URLSearchParams(retorno.slice(retorno.indexOf('?') + 1))) : {};
  const mes = /^\d{4}-\d{2}/.test(evento.inicio) ? evento.inicio.slice(0, 7) : undefined;
  const base = construirUrlCalendario({ ...leerContextoCalendario(previo), ...(mes ? { mes } : {}) });
  return `${base}${base.includes('?') ? '&' : '?'}evento=${evento.id.toLowerCase()}`;
}

/* ---------------------------------------------------------------- consulta */

type Ejecutor = Pick<Db, 'execute'>;

/**
 * El torneo de una edición por los mismos cuatro caminos que `crucesExactos`,
 * del revés: vínculo de la edición, vínculo de alguna de sus pruebas, clave de
 * la FIE (`fie-<temporada>-<clave>`) y clave de Skermo (`RFEE:<número>` con
 * arma, género, categoría, formato y una de las dos temporadas). Cada rama
 * entra por un índice (`sport_competition_edition_idx`, `event_source_key`,
 * `event_competition_filter_idx`). Si el registro lo absorbió otra tarjeta, se
 * devuelve la tarjeta.
 */
export async function leerEventoDeEdicion(db: Ejecutor, edicionId: string): Promise<EventoDeEdicion | null> {
  if (!UUID_RE.test(edicionId)) return null;
  const id = edicionId.toLowerCase();
  const resultado = await db.execute(sql`
    WITH c AS (
      SELECT source, season, competition_key, event_competition_id, weapon, gender, category, format
      FROM sport_competition WHERE edition_id = ${id}
    ),
    cand(evento) AS (
      SELECT se.event_id FROM sport_edition se WHERE se.id = ${id} AND se.event_id IS NOT NULL
      UNION
      SELECT ec.event_id FROM c CROSS JOIN event_competition ec ON ec.id = c.event_competition_id
      UNION
      SELECT ev.id FROM c CROSS JOIN event ev
        ON ev.source = 'fie' AND ev.source_id = 'fie-' || c.season || '-' || c.competition_key
      WHERE c.source = 'fie'
      UNION
      SELECT ev.id FROM c
      CROSS JOIN event_competition ec
        ON ec.weapon = c.weapon AND ec.gender = c.gender AND ec.category = c.category
       AND ec.format = c.format AND ec.source_id = substr(c.competition_key, 6)
      CROSS JOIN event ev ON ev.id = ec.event_id AND ev.source = 'skermo_rfee'
       AND substr(ev.start_date, 1, 4) IN (substr(c.season, 1, 4), substr(c.season, 6, 4))
      WHERE c.source = 'skermo_rfee' AND c.competition_key LIKE 'RFEE:%'
    )
    SELECT DISTINCT t.id AS id, t.name AS nombre, t.start_date AS inicio, t.end_date AS fin
    FROM cand CROSS JOIN event ev ON ev.id = cand.evento
    CROSS JOIN event t ON t.id = coalesce(ev.canonical_event_id, ev.id)
    ORDER BY t.start_date, t.id
    LIMIT 1`);
  const [fila] = filas<{ id: string; nombre: string; inicio: string; fin: string }>(resultado);
  return fila ? { id: fila.id, nombre: fila.nombre, inicio: String(fila.inicio).slice(0, 10), fin: String(fila.fin).slice(0, 10) } : null;
}

/* ------------------------------------------------------------------- caché */

const HORA = 3_600_000;
const FRESCO = 6 * HORA;
const CADUCA = 7 * 24 * HORA;

type Definidor = {
  definir<P extends readonly ParteClave[], T>(def: DefinicionCache<P, T>): Cacheado<P, T>;
};

export type FuentesEnlaces = {
  /** Las ediciones de un torneo por clave exacta (`edicionesExplorarDeEvento`). */
  edicionesDeEvento: (eventoId: string) => Promise<EdicionDeEvento[]>;
  /** El torneo de una edición (`leerEventoDeEdicion` con la base real). */
  eventoDeEdicion: (edicionId: string) => Promise<EventoDeEdicion | null>;
};

function registrar(que: string, error: unknown) {
  console.error(`[enlaces-calendario] ${que}:`, error instanceof Error ? error.name : 'desconocido');
}

async function conSesion(ctx: ContextoExplorador): Promise<'ok' | 'sin_sesion' | 'error'> {
  try {
    await exigirPerfil(ctx);
    return 'ok';
  } catch (error) {
    if (error instanceof Error && error.message === ERROR_NO_AUTENTICADO) return 'sin_sesion';
    registrar('la sesión no se pudo comprobar', error);
    return 'error';
  }
}

/**
 * Las dos lecturas con la caché compartida. Lo vacío también se guarda (dentro
 * de un objeto, porque la caché no guarda `null`): un torneo sin resultados o
 * una edición sin torneo son lo más común y no deben ir a D1 en cada visita.
 * Dependen de `deporte` y de `calendario`: cambian con una ingesta de
 * cualquiera de los dos.
 */
export function crearEnlacesCalendario({ cache, fuentes }: { cache: Definidor; fuentes: FuentesEnlaces }) {
  const ediciones = cache.definir({
    espacio: 'enlaces-evento-resultados',
    depende: ['deporte', 'calendario'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: async (eventoId: string) => ({ ediciones: soloConResultados(await fuentes.edicionesDeEvento(eventoId)) }),
  });

  const evento = cache.definir({
    espacio: 'enlaces-edicion-evento',
    depende: ['deporte', 'calendario'],
    frescoMs: FRESCO,
    caducaMs: CADUCA,
    cargar: async (edicionId: string) => ({ evento: await fuentes.eventoDeEdicion(edicionId) }),
  });

  /** Ediciones y pruebas con resultados de un torneo del calendario, y adónde lleva «Resultados». */
  async function resultadosDeEvento(ctx: ContextoExplorador, eventoId: unknown): Promise<ResultadosDeEvento> {
    const sesion = await conSesion(ctx);
    if (sesion !== 'ok') return { tipo: sesion };
    if (typeof eventoId !== 'string' || !UUID_RE.test(eventoId)) return { tipo: 'entrada_invalida' };
    const id = eventoId.toLowerCase();
    try {
      const { ediciones: lista } = await ediciones(id).catch(async (error: unknown) => {
        registrar('la caché de resultados del torneo falló', error);
        return { ediciones: soloConResultados(await fuentes.edicionesDeEvento(id)) };
      });
      return { tipo: 'ok', ediciones: lista, destino: destinoDeEvento(lista) };
    } catch (error) {
      registrar('los resultados del torneo no se pudieron leer', error);
      return { tipo: 'error' };
    }
  }

  /** El torneo del calendario de una edición; `null` si no lo hay o no se pudo leer (el enlace no sale). */
  async function eventoDeEdicion(ctx: ContextoExplorador, edicionId: string): Promise<EventoDeEdicion | null> {
    if ((await conSesion(ctx)) !== 'ok' || !UUID_RE.test(edicionId)) return null;
    const id = edicionId.toLowerCase();
    try {
      const r = await evento(id).catch(async (error: unknown) => {
        registrar('la caché del torneo de la edición falló', error);
        return { evento: await fuentes.eventoDeEdicion(id) };
      });
      return r.evento;
    } catch (error) {
      registrar('el torneo de la edición no se pudo leer', error);
      return null;
    }
  }

  return { resultadosDeEvento, eventoDeEdicion };
}
