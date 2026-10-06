import { sql } from 'drizzle-orm';
import { FUENTES_CONTINENTALES, FUENTES_RANKING } from '@/lib/sport/rankings-internacionales-fuentes';
import { filas, type ContextoExplorador } from './contexto';
import { listaUuid } from './filtros-sql';
import {
  construirRankingInternacional,
  fuentesParaPais,
  sqlRankingInternacionalDePersonas,
  sqlTemporadasVigentes,
  type BloqueRankingInternacional,
  type FilaRankingInternacional,
  type PuestoInternacional,
} from './ranking-internacional';
import { ordenCategoriaVisible } from './presentacion';
import type { MejorMundial, RankingNacional, ResumenMundial } from './ranking-nacional';
import type { EntradaRankingOficial } from './tipos';

/**
 * Rankings de organismos de fuera para el perfil, partidos en lo que necesita
 * la cabecera y lo que sólo pinta la pestaña:
 *
 *   - `leerRankingAmbitos` (camino crítico): FIE (vigente + histórico) y, para
 *     quien no es español, el ranking de su federación. La cabecera saca de
 *     aquí el mejor puesto internacional de toda la carrera. También si hay
 *     algún puesto europeo, para que la pestaña salga aunque sea lo único.
 *   - `leerRankingEuropeo` (diferido): la EFC, que sólo sale en la pestaña.
 *
 * El nacional de un español es la RFEE y no sale de aquí: lo lee
 * `leerRankingNacional`, con la regla de la tabla oficial para la vigente.
 */

export type RankingAmbitos = {
  pais: string | null;
  internacional: BloqueRankingInternacional | null;
  /** Federación propia de un extranjero; `null` para españoles o si su federación no se lee. */
  nacionalFuera: BloqueRankingInternacional | null;
  /**
   * Tiene algún puesto europeo (EFC). El bloque llega en diferido; esto sólo
   * decide si sale la pestaña Ranking.
   */
  europeo?: boolean;
};

export const RANKING_AMBITOS_VACIO: RankingAmbitos = { pais: null, internacional: null, nacionalFuera: null, europeo: false };

/** Sin país publicado se le trata como español: la base es de la RFEE. */
export const esEspanol = (pais: string | null) => pais === null || pais === 'ESP';

export function fuentesCabecera(pais: string | null): string[] {
  return fuentesParaPais(pais).filter((f) => {
    const d = FUENTES_RANKING[f as keyof typeof FUENTES_RANKING];
    return d && d.ambito !== 'continental' && !(d.ambito === 'nacional' && esEspanol(pais));
  });
}

async function leerBloques(db: ContextoExplorador['db'], ids: readonly string[], fuentes: readonly string[]) {
  const [rows, vigentes] = await Promise.all([
    db.execute(sqlRankingInternacionalDePersonas(ids, fuentes)),
    db.execute(sqlTemporadasVigentes(fuentes)),
  ]);
  return construirRankingInternacional(
    filas<FilaRankingInternacional>(rows),
    filas<{ fuente: string; temporada: string | null }>(vigentes),
  );
}

export async function leerRankingAmbitos(
  db: ContextoExplorador['db'],
  ids: readonly string[],
  canonicaId: string,
): Promise<RankingAmbitos> {
  if (ids.length === 0) return RANKING_AMBITOS_VACIO;
  try {
    const [personas, europeo] = await Promise.all([
      db.execute(sql`SELECT country_code AS pais FROM sport_person WHERE id = ${canonicaId}`),
      hayRankingEuropeo(db, ids),
    ]);
    const pais = filas<{ pais: string | null }>(personas)[0]?.pais?.trim().toUpperCase() || null;
    const fuentes = fuentesCabecera(pais);
    if (fuentes.length === 0) return { ...RANKING_AMBITOS_VACIO, pais, europeo };
    const bloques = await leerBloques(db, ids, fuentes);
    return { pais, internacional: bloques.mundial, nacionalFuera: esEspanol(pais) ? null : bloques.nacional, europeo };
  } catch {
    return RANKING_AMBITOS_VACIO;
  }
}

/**
 * Si la persona tiene algún puesto en una lista continental, sin traer la
 * lista: va por `sport_ranking_entry_person_idx` y para en la primera fila.
 * No mira si la publicación es la más reciente de su clasificación (eso lo
 * hace el bloque diferido); una fila con puesto en una revisión superada no
 * desaparece en la siguiente salvo corrección de la fuente.
 */
export function sqlHayRankingEuropeo(ids: readonly string[]) {
  return sql`
    SELECT EXISTS (
      SELECT 1 FROM sport_ranking_entry e
      JOIN sport_ranking_publication p ON p.id = e.publication_id
      WHERE e.person_id IN (${listaUuid(ids)})
        AND e.position IS NOT NULL
        AND p.format = 'INDIVIDUAL'
        AND p.source IN (SELECT value FROM json_each(${JSON.stringify(FUENTES_CONTINENTALES)}))
    ) AS hay`;
}

async function hayRankingEuropeo(db: ContextoExplorador['db'], ids: readonly string[]): Promise<boolean> {
  if (FUENTES_CONTINENTALES.length === 0) return false;
  try {
    return Number(filas<{ hay: number }>(await db.execute(sqlHayRankingEuropeo(ids)))[0]?.hay ?? 0) === 1;
  } catch {
    return false;
  }
}

/** «2024» (FIE) o «2023-2024»: el año en que termina. */
const anioFinDe = (temporada: string) => Number(/^\d{4}$/.test(temporada) ? temporada : temporada.slice(-4));

const porCategoriaYPuesto = (a: PuestoInternacional, b: PuestoInternacional) =>
  ordenCategoriaVisible(a.categoria) - ordenCategoriaVisible(b.categoria) || (a.puesto ?? Infinity) - (b.puesto ?? Infinity);

function puestosFie(lista: readonly MejorMundial[], fuente: string): PuestoInternacional[] {
  return lista
    .map((m) => ({
      fuente, organismo: 'FIE', ambito: 'mundial' as const, temporada: m.temporada,
      anioFin: anioFinDe(m.temporada), arma: m.arma, genero: m.genero, categoria: m.categoria, categoriaRaw: m.categoria,
      puesto: m.puesto, puntos: null, de: null, publicadoEl: '', url: null,
    }))
    .filter((p) => Number.isFinite(p.anioFin))
    .sort(porCategoriaYPuesto);
}

/**
 * El bloque internacional de la pestaña con la misma fuente que la cabecera
 * (`chipsRanking`): los puestos de la clasificación FIE vigente (la de
 * /ranking) cuando la lista guardada por temporada aún no trae la vigente y,
 * si no hay listas por temporada cargadas, un bloque sólo con la
 * clasificación vigente y los mejores puestos FIE. Si la cabecera enseña un
 * puesto internacional, la pestaña también.
 */
export function conClasificacionVigente(
  bloque: BloqueRankingInternacional | null,
  resumen: ResumenMundial | null | undefined,
): BloqueRankingInternacional | null {
  const actual = puestosFie(resumen?.actuales ?? [], 'fie_clasificacion');
  if (bloque) {
    if (bloque.actual.length > 0 || actual.length === 0) return bloque;
    return { ...bloque, actual, vigente: actual[0].anioFin };
  }
  const mejores = puestosFie(resumen?.mejores ?? [], 'fie_tiradores');
  const todos = [...actual, ...mejores];
  if (todos.length === 0) return null;
  // Como la fila de la cabecera: la categoría más alta y, dentro, el mejor puesto.
  const mejor = [...todos].sort((a, b) => porCategoriaYPuesto(a, b) || b.anioFin - a.anioFin)[0];
  return {
    ambito: 'mundial',
    organismos: ['FIE'],
    vigente: actual[0]?.anioFin ?? (resumen?.vigente ? anioFinDe(resumen.vigente) : null),
    actual,
    ultimaTemporada: Math.max(...todos.map((p) => p.anioFin)),
    mejor,
    mejores: mejores.length > 0 ? mejores : actual,
    series: [],
  };
}

/** Si el bloque tiene algo que pintar: puesto vigente, mejor puesto o alguna temporada con puesto. */
export function tieneRanking(bloque: BloqueRankingInternacional | null | undefined): bloque is BloqueRankingInternacional {
  if (!bloque) return false;
  return bloque.actual.some((p) => p.puesto !== null)
    || bloque.mejor?.puesto != null
    || bloque.series.some((s) => s.serie.some((p) => p.puesto !== null));
}

export type BloquesRankingPerfil = {
  internacional: BloqueRankingInternacional | null;
  /** Lista FIE de la última temporada, para lecturas sin ámbitos (DTO anterior). */
  mundial: readonly EntradaRankingOficial[] | null;
  /** RFEE, para un español o sin país publicado. */
  nacional: RankingNacional | null;
  /** Federación propia de un extranjero. */
  nacionalFuera: BloqueRankingInternacional | null;
  /** Llegará un bloque europeo (diferido). */
  europeo: boolean;
  /** Hay algo que pintar en la pestaña; sin nada, la pestaña no sale. */
  hay: boolean;
};

/**
 * Qué bloques lleva la pestaña Ranking del perfil. Cada bloque entra sólo si
 * su componente va a pintar algo, así una pestaña visible nunca sale vacía.
 */
export function bloquesRankingPerfil(extras: {
  rankingAmbitos?: RankingAmbitos | null;
  rankingNacional?: RankingNacional | null;
  rankingMundial?: readonly EntradaRankingOficial[] | null;
  resumenMundial?: ResumenMundial | null;
}): BloquesRankingPerfil {
  const ambitos = extras.rankingAmbitos ?? null;
  const extranjero = ambitos !== null && !esEspanol(ambitos.pais);
  const nacional = !extranjero && extras.rankingNacional?.mejor && extras.rankingNacional.listas.length > 0 ? extras.rankingNacional : null;
  const nacionalFuera = extranjero && tieneRanking(ambitos.nacionalFuera) ? ambitos.nacionalFuera : null;
  const leido = conClasificacionVigente(ambitos?.internacional ?? null, extras.resumenMundial);
  const internacional = tieneRanking(leido) ? leido : null;
  const fie = (extras.rankingMundial ?? []).filter((e) => e.puesto !== null);
  const mundial = !internacional && fie.length > 0 ? fie : null;
  const europeo = ambitos?.europeo === true;
  return {
    internacional, mundial, nacional, nacionalFuera, europeo,
    hay: internacional !== null || mundial !== null || nacional !== null || nacionalFuera !== null || europeo,
  };
}

export async function leerRankingEuropeo(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<BloqueRankingInternacional | null> {
  if (ids.length === 0 || FUENTES_CONTINENTALES.length === 0) return null;
  try {
    return (await leerBloques(db, ids, FUENTES_CONTINENTALES)).continental;
  } catch {
    return null;
  }
}
