import { sql } from 'drizzle-orm';
import {
  FUENTES_RANKING,
  type AmbitoRanking,
} from '@/lib/sport/rankings-internacionales-fuentes';
import { filas, type ContextoExplorador } from './contexto';
import { listaUuid } from './filtros-sql';
import { resolverPersona } from './personas';
import type { Arma, Genero } from './tipos';

/**
 * Rankings publicados por organismos de fuera (FIE, confederaciones
 * continentales, federaciones nacionales) de UNA persona, temporada a
 * temporada. Sólo datos: la presentación es de la interfaz.
 *
 * - Mundial: `fie_tiradores` (temporada en curso, ingesta diaria) +
 *   `fie_historico` (temporadas anteriores). Mismo organismo, una sola serie.
 * - Continental: `efc_ranking` (Europa). Las demás confederaciones publican
 *   en Ophardt, cuyo robots.txt prohíbe el acceso automatizado.
 * - Nacional: la federación del país de la persona (`FFE`, `FIS`, `FAHK`,
 *   `MVSZ` y también la RFEE para españoles).
 *
 * De cada lista (fuente, temporada, arma, género, categoría publicada) cuenta
 * sólo la publicación más reciente: si la persona no figura en ella no se le
 * atribuye una lectura anterior de esa misma lista.
 */

export type CategoriaRanking = 'M14' | 'M15' | 'M17' | 'M20' | 'M23' | 'ABS' | 'VET' | string;

export type FilaRankingInternacional = {
  fuente: string;
  temporada: string;
  arma: Arma;
  genero: Genero;
  categoria: CategoriaRanking;
  categoriaRaw: string;
  publicadoEl: string;
  url: string | null;
  total: number | null;
  puesto: number | null;
  puntos: string | null;
};

export type PuestoInternacional = {
  fuente: string;
  organismo: string;
  ambito: AmbitoRanking;
  /** Temporada tal como la guarda la fuente («2024» en la FIE, «2023-2024» en el resto). */
  temporada: string;
  /** Año en que termina la temporada: compara fuentes con formatos distintos. */
  anioFin: number;
  arma: Arma;
  genero: Genero;
  categoria: CategoriaRanking;
  categoriaRaw: string;
  puesto: number | null;
  puntos: number | null;
  /** Tamaño publicado de la lista, si se conoce. */
  de: number | null;
  publicadoEl: string;
  url: string | null;
};

export type SerieInternacional = {
  clave: string;
  organismo: string;
  arma: Arma;
  genero: Genero;
  categoria: CategoriaRanking;
  /** Una por temporada, de la más antigua a la más reciente. */
  serie: PuestoInternacional[];
  ultimo: PuestoInternacional;
  mejor: PuestoInternacional | null;
};

export type BloqueRankingInternacional = {
  ambito: AmbitoRanking;
  /** Organismos con datos de la persona (p. ej. ['FIE'] o ['EFC']). */
  organismos: string[];
  /** Última temporada publicada por esos organismos (de cualquiera, no de la persona); año de fin. */
  vigente: number | null;
  /** Puestos de la persona en la temporada vigente; vacío si ya no figura. */
  actual: PuestoInternacional[];
  /** Última temporada en que figura (año de fin). */
  ultimaTemporada: number | null;
  /** Mejor puesto de toda su carrera (empate: categoría mayor, luego el más reciente). */
  mejor: PuestoInternacional | null;
  /** Mejor puesto por categoría y arma, categoría mayor primero. */
  mejores: PuestoInternacional[];
  series: SerieInternacional[];
};

export type RankingInternacional = {
  mundial: BloqueRankingInternacional | null;
  continental: BloqueRankingInternacional | null;
  nacional: BloqueRankingInternacional | null;
};

export const RANKING_INTERNACIONAL_VACIO: RankingInternacional = { mundial: null, continental: null, nacional: null };

const ORDEN_CATEGORIA = ['ABS', 'M23', 'M20', 'M17', 'M15', 'M14', 'VET'];
const ordenCategoria = (c: string) => {
  const i = ORDEN_CATEGORIA.indexOf(c);
  return i < 0 ? ORDEN_CATEGORIA.length : i;
};

export function anioFinTemporada(temporada: string): number | null {
  const m = /^(\d{4})(?:\s*[-/]\s*(\d{4}))?$/.exec(temporada.trim());
  if (!m) return null;
  return Number(m[2] ?? m[1]);
}

/** Fuentes que se leen para una persona de ese país (mundial y continental siempre). */
export function fuentesParaPais(pais: string | null): string[] {
  return Object.entries(FUENTES_RANKING)
    .filter(([, d]) => d.ambito !== 'nacional' || (pais !== null && d.pais === pais))
    .map(([k]) => k);
}

export function sqlRankingInternacionalDePersonas(ids: readonly string[], fuentes: readonly string[]) {
  return sql`
    SELECT p.source AS fuente, p.season AS temporada, p.weapon AS arma, p.gender AS genero,
           p.category AS categoria, p.category_raw AS "categoriaRaw", p.published_on AS "publicadoEl",
           p.source_url AS url, p.published_total AS total, e.position AS puesto, e.points AS puntos
    FROM sport_ranking_entry e
    JOIN sport_ranking_publication p ON p.id = e.publication_id
    WHERE e.person_id IN (${listaUuid(ids)})
      AND p.source IN (SELECT value FROM json_each(${JSON.stringify(fuentes)}))
      AND p.format = 'INDIVIDUAL'
      AND NOT EXISTS (
        SELECT 1 FROM sport_ranking_publication q
        WHERE q.source = p.source AND q.season = p.season AND q.weapon = p.weapon
          AND q.gender = p.gender AND q.category_raw = p.category_raw AND q.format = p.format
          AND (q.published_on > p.published_on
            OR (q.published_on = p.published_on AND q.fetched_at > p.fetched_at)
            OR (q.published_on = p.published_on AND q.fetched_at = p.fetched_at AND q.id > p.id)))
    ORDER BY p.source, p.season, p.weapon, p.category_raw`;
}

export function sqlTemporadasVigentes(fuentes: readonly string[]) {
  return sql`
    SELECT source AS fuente, max(season) AS temporada FROM sport_ranking_publication
    WHERE source IN (SELECT value FROM json_each(${JSON.stringify(fuentes)})) AND format = 'INDIVIDUAL'
    GROUP BY source`;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function aPuesto(r: FilaRankingInternacional): PuestoInternacional | null {
  const d = FUENTES_RANKING[r.fuente as keyof typeof FUENTES_RANKING];
  const anioFin = anioFinTemporada(String(r.temporada));
  if (!d || anioFin === null) return null;
  const puesto = numero(r.puesto);
  return {
    fuente: r.fuente,
    organismo: d.organismo,
    ambito: d.ambito,
    temporada: String(r.temporada),
    anioFin,
    arma: r.arma,
    genero: r.genero,
    categoria: r.categoria,
    categoriaRaw: r.categoriaRaw,
    puesto: puesto !== null && Number.isInteger(puesto) && puesto > 0 ? puesto : null,
    puntos: numero(r.puntos),
    de: numero(r.total),
    publicadoEl: r.publicadoEl,
    url: r.url,
  };
}

/** ¿`b` es mejor que `a`? Menor puesto; empate: categoría mayor; luego más reciente. */
function mejora(a: PuestoInternacional | null, b: PuestoInternacional): boolean {
  if (b.puesto === null) return false;
  if (a === null || a.puesto === null) return true;
  if (b.puesto !== a.puesto) return b.puesto < a.puesto;
  const c = ordenCategoria(b.categoria) - ordenCategoria(a.categoria);
  if (c !== 0) return c < 0;
  return b.anioFin > a.anioFin;
}

export function construirBloque(
  ambito: AmbitoRanking,
  puestos: readonly PuestoInternacional[],
  vigente: number | null,
): BloqueRankingInternacional | null {
  const propios = puestos.filter((p) => p.ambito === ambito);
  if (propios.length === 0) return null;

  // Mundial: fie_tiradores y fie_historico son la misma serie (organismo + lista).
  const porSerie = new Map<string, { base: PuestoInternacional; porAnio: Map<number, PuestoInternacional> }>();
  for (const p of propios) {
    const clave = `${p.organismo}|${p.arma}|${p.genero}|${p.categoria}|${p.categoriaRaw}`;
    const s = porSerie.get(clave) ?? { base: p, porAnio: new Map<number, PuestoInternacional>() };
    const previo = s.porAnio.get(p.anioFin);
    // Dos lecturas del mismo año (una por fuente): la publicada más tarde.
    if (!previo || p.publicadoEl > previo.publicadoEl) s.porAnio.set(p.anioFin, p);
    porSerie.set(clave, s);
  }

  const series: SerieInternacional[] = [...porSerie.entries()].map(([clave, { base, porAnio }]) => {
    const serie = [...porAnio.values()].sort((a, b) => a.anioFin - b.anioFin);
    return {
      clave,
      organismo: base.organismo,
      arma: base.arma,
      genero: base.genero,
      categoria: base.categoria,
      serie,
      ultimo: serie[serie.length - 1],
      mejor: serie.reduce<PuestoInternacional | null>((m, p) => (mejora(m, p) ? p : m), null),
    };
  });

  const todos = series.flatMap((s) => s.serie);
  const ultimaTemporada = Math.max(...todos.map((p) => p.anioFin));
  const actual = vigente === null ? [] : todos.filter((p) => p.anioFin === vigente && p.puesto !== null)
    .sort((a, b) => a.puesto! - b.puesto! || ordenCategoria(a.categoria) - ordenCategoria(b.categoria) || a.arma.localeCompare(b.arma));

  const porCategoria = new Map<string, PuestoInternacional>();
  for (const p of todos) {
    const k = `${p.organismo}|${p.categoria}|${p.arma}`;
    if (mejora(porCategoria.get(k) ?? null, p)) porCategoria.set(k, p);
  }
  const mejores = [...porCategoria.values()]
    .sort((a, b) => ordenCategoria(a.categoria) - ordenCategoria(b.categoria) || a.puesto! - b.puesto! || a.arma.localeCompare(b.arma));

  return {
    ambito,
    organismos: [...new Set(propios.map((p) => p.organismo))].sort(),
    vigente,
    actual,
    ultimaTemporada,
    mejor: todos.reduce<PuestoInternacional | null>((m, p) => (mejora(m, p) ? p : m), null),
    mejores,
    series: series.sort((a, b) =>
      ordenCategoria(a.categoria) - ordenCategoria(b.categoria) || a.arma.localeCompare(b.arma) || a.organismo.localeCompare(b.organismo)),
  };
}

export function construirRankingInternacional(
  rows: readonly FilaRankingInternacional[],
  vigentes: readonly { fuente: string; temporada: string | null }[],
): RankingInternacional {
  const puestos = rows.map(aPuesto).filter((p): p is PuestoInternacional => p !== null);
  const vigenteDe = (ambito: AmbitoRanking) => {
    const organismos = new Set(puestos.filter((p) => p.ambito === ambito).map((p) => p.organismo));
    const anios = vigentes
      .filter((v) => {
        const d = FUENTES_RANKING[v.fuente as keyof typeof FUENTES_RANKING];
        return d && d.ambito === ambito && organismos.has(d.organismo);
      })
      .map((v) => (v.temporada ? anioFinTemporada(v.temporada) : null))
      .filter((a): a is number => a !== null);
    return anios.length ? Math.max(...anios) : null;
  };
  return {
    mundial: construirBloque('mundial', puestos, vigenteDe('mundial')),
    continental: construirBloque('continental', puestos, vigenteDe('continental')),
    nacional: construirBloque('nacional', puestos, vigenteDe('nacional')),
  };
}

/** Por ids ya resueltos (canónica + fundidas) y país de la persona. Un fallo devuelve el vacío. */
export async function leerRankingInternacionalDeIds(
  db: ContextoExplorador['db'],
  ids: readonly string[],
  pais: string | null,
): Promise<RankingInternacional> {
  if (ids.length === 0) return RANKING_INTERNACIONAL_VACIO;
  try {
    const fuentes = fuentesParaPais(pais);
    const [rows, vigentes] = await Promise.all([
      db.execute(sqlRankingInternacionalDePersonas(ids, fuentes)),
      db.execute(sqlTemporadasVigentes(fuentes)),
    ]);
    return construirRankingInternacional(
      filas<FilaRankingInternacional>(rows),
      filas<{ fuente: string; temporada: string | null }>(vigentes),
    );
  } catch {
    return RANKING_INTERNACIONAL_VACIO;
  }
}

/** Por id de persona (cualquiera del grupo): sigue las fusiones y toma el país de la canónica. */
export async function leerRankingInternacional(
  db: ContextoExplorador['db'],
  personaId: string,
): Promise<RankingInternacional> {
  try {
    const persona = await resolverPersona(db, personaId);
    if (!persona) return RANKING_INTERNACIONAL_VACIO;
    const [cabecera] = filas<{ pais: string | null }>(
      await db.execute(sql`SELECT country_code AS pais FROM sport_person WHERE id = ${persona.canonicaId}`),
    );
    return await leerRankingInternacionalDeIds(db, persona.ids, cabecera?.pais ?? null);
  } catch {
    return RANKING_INTERNACIONAL_VACIO;
  }
}
