import { sql } from 'drizzle-orm';
import { ERROR_NO_AUTENTICADO, exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { aTiradoresSugeridos } from './perfil-modelo';
import { resolverPersona } from './personas';
import { resolverPersonaPropia } from './propietario';
import { contarSiguiendo, leerFeedSiguiendo } from './seguidos';
import { sqlTiradoresSugeridos, type FilaSugerido } from './sugeridos';
import type { EntradaSiguiendo } from './tipos-social';
import type { Arma, Genero } from './tipos';

/** Persona propuesta para empezar a seguir cuando el feed está vacío. */
export type PersonaParaSeguir = { id: string; nombre: string; pais: string | null; motivo: string };

export type VistaSiguiendo =
  | { tipo: 'sin_sesion' }
  | { tipo: 'entrada_invalida' }
  | { tipo: 'cursor_invalido' }
  | { tipo: 'no_disponible' }
  | { tipo: 'error' }
  | {
      tipo: 'ok';
      items: EntradaSiguiendo[];
      siguiente: string | null;
      sinResultados: boolean;
      /** Sólo en una primera página vacía; `null` = no se pudieron leer. */
      sugeridos?: PersonaParaSeguir[] | null;
    };

export const LIMITE_FEED = 20;
const MAX_PROPUESTAS = 12;

function esNoAutenticado(error: unknown): boolean {
  return error instanceof Error && error.message === ERROR_NO_AUTENTICADO;
}

function aviso(que: string, error: unknown) {
  console.error(`[explorar] ${que} no se pudo leer:`, error instanceof Error ? error.name : 'desconocido');
}

/** Personas raíz que ya sigue la cuenta (para no proponerlas otra vez). */
function sqlSeguidasRaiz(profileId: string) {
  return sql`
    SELECT DISTINCT coalesce(p.merged_into_person_id, p.id) AS id
    FROM sport_favorite f CROSS JOIN sport_person p ON p.id = f.person_id
    WHERE f.profile_id = ${profileId}`;
}

/**
 * Españoles mejor clasificados en el ranking FIE absoluto individual de las
 * dos últimas temporadas importadas, dos por arma y género. Es una lista
 * publicada, no una valoración propia.
 */
export function sqlDestacadosRanking(limite: number) {
  return sql`
    WITH temporadas AS (
      SELECT DISTINCT season FROM sport_ranking_publication
      WHERE source = 'fie_tiradores' AND category = 'ABS' AND format = 'INDIVIDUAL'
      ORDER BY season DESC LIMIT 2
    ), mejores AS (
      SELECT coalesce(per.merged_into_person_id, per.id) AS id, min(e.position) AS puesto,
             p.weapon AS arma, p.gender AS genero
      FROM sport_ranking_publication p
      CROSS JOIN sport_ranking_entry e ON e.publication_id = p.id
      CROSS JOIN sport_person per ON per.id = e.person_id
      WHERE p.source = 'fie_tiradores' AND p.category = 'ABS' AND p.format = 'INDIVIDUAL'
        AND p.season IN (SELECT season FROM temporadas)
        AND e.country_code = 'ESP' AND e.position > 0
      GROUP BY 1, 3, 4
    ), orden AS (
      SELECT m.*, row_number() OVER (PARTITION BY m.arma, m.genero ORDER BY m.puesto, m.id) AS k FROM mejores m
    )
    SELECT o.id, p.display_name AS nombre, p.country_code AS pais, o.puesto, o.arma, o.genero
    FROM orden o CROSS JOIN sport_person p ON p.id = o.id
    WHERE o.k <= 2 AND p.merged_into_person_id IS NULL
    ORDER BY o.puesto, o.id
    LIMIT ${limite}`;
}

type FilaDestacado = { id: string; nombre: string; pais: string | null; puesto: number; arma: Arma; genero: Genero };

/**
 * La lista de destacados es la misma para todas las cuentas y sólo cambia al
 * importar un ranking, pero leerla recorre todas las publicaciones semanales
 * de dos temporadas (~65 ms en la copia de producción). Se recuerda un rato
 * por base: `db` es un objeto por isolate en producción y uno por fixture en
 * las pruebas, así que nada se cruza entre bases.
 */
const VIGENCIA_DESTACADOS_MS = 10 * 60_000;
/** Dos por arma y género: nunca pasan de unas decenas. */
const TOPE_DESTACADOS = 200;
const destacadosRecordados = new WeakMap<object, { hasta: number; filas: Promise<FilaDestacado[]> }>();

function destacadosRanking(ctx: ContextoExplorador): Promise<FilaDestacado[]> {
  const clave = ctx.db as object;
  const recordado = destacadosRecordados.get(clave);
  if (recordado && recordado.hasta > Date.now()) return recordado.filas;
  const promesa = ctx.db.execute(sqlDestacadosRanking(TOPE_DESTACADOS)).then((r) => filas<FilaDestacado>(r));
  destacadosRecordados.set(clave, { hasta: Date.now() + VIGENCIA_DESTACADOS_MS, filas: promesa });
  promesa.catch(() => {
    if (destacadosRecordados.get(clave)?.filas === promesa) destacadosRecordados.delete(clave);
  });
  return promesa;
}

/** Los destacados del ranking como propuestas, sin filtrar. Igual para todas las cuentas. */
export async function leerDestacadosParaSeguir(ctx: ContextoExplorador): Promise<PersonaParaSeguir[]> {
  return (await destacadosRanking(ctx)).map((d) => ({
    id: d.id,
    nombre: d.nombre,
    pais: d.pais,
    motivo: `${Number(d.puesto)}º internacional`,
  }));
}

/**
 * Tiradores sugeridos de una persona (rivales, mismo club, pruebas
 * compartidas), sin filtrar por cuenta: son hechos deportivos publicados y
 * valen para cualquiera. `null` si la persona no existe.
 */
export async function leerSugeridosDePersona(
  ctx: ContextoExplorador,
  personaId: string,
): Promise<{ canonicaId: string; sugeridos: PersonaParaSeguir[] } | null> {
  const persona = await resolverPersona(ctx.db, personaId);
  if (!persona) return null;
  const sugeridos = aTiradoresSugeridos(
    filas<FilaSugerido>(await ctx.db.execute(sqlTiradoresSugeridos(persona.ids, persona.canonicaId))),
  ).map((s) => ({
    id: s.id,
    nombre: s.nombre,
    pais: s.pais,
    // En Explorar no se enseñan clubes: quien comparte club sale como «Mismas pruebas».
    motivo: s.motivo === 'rival_frecuente' ? 'Rival frecuente'
      : s.motivo === 'asaltos' ? 'Rival'
      : 'Mismas pruebas',
  }));
  return { canonicaId: persona.canonicaId, sugeridos };
}

/**
 * De dónde salen las listas comunes a todas las cuentas. Por defecto, de D1;
 * Buscar las pasa por la caché compartida (`cache-pantallas.ts`).
 */
export type FuentesPropuestas = {
  destacados?: () => Promise<PersonaParaSeguir[]>;
  sugeridosDe?: (personaId: string) => Promise<{ canonicaId: string; sugeridos: PersonaParaSeguir[] } | null>;
};

/**
 * Propuestas para un feed vacío: si la cuenta tiene ficha propia confirmada,
 * sus tiradores sugeridos (rivales, mismo club, pruebas compartidas); si no,
 * los españoles mejor situados en el ranking FIE. Nunca quien ya se sigue:
 * las listas son comunes y lo de la cuenta (su ficha y a quién sigue) se
 * aplica aquí, al vuelo.
 */
export async function leerPropuestasParaSeguir(
  ctx: ContextoExplorador,
  fuentes: FuentesPropuestas = {},
): Promise<PersonaParaSeguir[]> {
  const perfil = await exigirPerfil(ctx);
  const [propia, seguidas] = await Promise.all([
    resolverPersonaPropia(ctx, perfil.profileId),
    ctx.db.execute(sqlSeguidasRaiz(perfil.profileId)),
  ]);
  const yaSeguidas = new Set(filas<{ id: string }>(seguidas).map((f) => f.id));
  if (propia.estado === 'confirmada') {
    const propios = await (fuentes.sugeridosDe ?? ((id: string) => leerSugeridosDePersona(ctx, id)))(propia.personaId);
    if (propios) {
      yaSeguidas.add(propios.canonicaId);
      const sugeridos = propios.sugeridos.filter((s) => !yaSeguidas.has(s.id));
      if (sugeridos.length > 0) return sugeridos.slice(0, MAX_PROPUESTAS);
    }
  }
  const destacados = await (fuentes.destacados ?? (() => leerDestacadosParaSeguir(ctx)))();
  return destacados.filter((d) => !yaSeguidas.has(d.id)).slice(0, MAX_PROPUESTAS);
}

/** Página del feed. Una primera página vacía trae además propuestas para seguir. */
export async function cargarSiguiendo(
  ctx: ContextoExplorador,
  criterios: { cursor?: string; soloMedallas?: boolean },
  fuentes?: FuentesPropuestas,
): Promise<VistaSiguiendo> {
  try {
    const r = await leerFeedSiguiendo(ctx, {
      ...(criterios.cursor ? { cursor: criterios.cursor } : {}),
      ...(criterios.soloMedallas ? { soloMedallas: true } : {}),
      limite: LIMITE_FEED,
    });
    if (r.estado !== 'ok') return { tipo: r.estado };
    if (!r.sinResultados || criterios.cursor) {
      return { tipo: 'ok', items: r.items, siguiente: r.siguiente, sinResultados: r.sinResultados };
    }
    let sugeridos: PersonaParaSeguir[] | null;
    try {
      sugeridos = await leerPropuestasParaSeguir(ctx, fuentes);
    } catch (error) {
      if (esNoAutenticado(error)) throw error;
      aviso('las propuestas para seguir', error);
      sugeridos = null;
    }
    return { tipo: 'ok', items: r.items, siguiente: r.siguiente, sinResultados: true, sugeridos };
  } catch (error) {
    if (esNoAutenticado(error)) return { tipo: 'sin_sesion' };
    aviso('el feed de Siguiendo', error);
    return { tipo: 'error' };
  }
}

/** «Siguiendo N»; `null` sin sesión, sin esquema o si falla (no se enseña un cero inventado). */
export async function cargarConteoSiguiendo(ctx: ContextoExplorador): Promise<number | null> {
  try {
    const r = await contarSiguiendo(ctx);
    return r.estado === 'ok' ? r.siguiendo : null;
  } catch (error) {
    if (!esNoAutenticado(error)) aviso('el número de personas seguidas', error);
    return null;
  }
}
