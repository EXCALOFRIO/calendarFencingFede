import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';
import {
  SQL_LISTAS_OFICIALES,
  claveListaNacional,
  decidirLecturas,
  type ListaLeida,
} from '@/lib/sport/explorar/ranking-nacional';
import { personaDeFilaOficial } from './personas-ranking';
import type { ArmaNacional, FiltroRankingNacional, GeneroNacional } from '@/lib/ranking/url-nacional';
import { type CutoffStatus, cutoffStatus, loadRankingRules, pickRule } from '@/lib/ranking/compute';
import { titular } from '@/lib/utils';
import {
  type FilaOficial,
  type RankingGroupKey,
  type TablaOficial,
  anioNacimientoVisible,
  getRankingSeason,
} from './ranking';

/**
 * Clasificación nacional OFICIAL de la RFEE de cualquier temporada, leída de
 * `sport_ranking_publication` / `sport_ranking_entry` (fuente `skermo_ranking`).
 * De cada lista vale sólo la publicación más reciente de la temporada, salvo
 * que la tabla oficial (`official_ranking_entry`) tenga esa lista leída
 * después: entonces manda ella (`decidirLecturas`). Nada de aquí lee el
 * cálculo interno.
 */

const FUENTE = 'skermo_ranking';

type Ejecutor = Pick<Db, 'execute'>;

function filasDe<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const rows = (r as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Publicaciones vigentes (la última de cada lista) de una temporada. */
const vigentes = (temporada: string) => sql`
  SELECT * FROM (
    SELECT p.*, row_number() OVER (
      PARTITION BY p.weapon, p.gender, p.category_raw
      ORDER BY p.published_on DESC, p.fetched_at DESC, p.id DESC) AS orden
    FROM sport_ranking_publication p
    WHERE p.source = ${FUENTE} AND p.format = 'INDIVIDUAL' AND p.season = ${temporada}
  ) WHERE orden = 1`;

export const SQL_TEMPORADAS_NACIONALES = sql`
  SELECT season AS temporada FROM sport_ranking_publication
  WHERE source = ${FUENTE} AND format = 'INDIVIDUAL'
  UNION
  SELECT season_label FROM official_ranking_entry
  ORDER BY 1 DESC`;

export async function listarTemporadasNacionales(db: Ejecutor): Promise<string[]> {
  return filasDe<{ temporada: string }>(await db.execute(SQL_TEMPORADAS_NACIONALES)).map((f) => f.temporada);
}

export type GrupoNacional = {
  arma: ArmaNacional;
  genero: GeneroNacional;
  /** Código agrupado (`VET`). */
  categoria: string;
  /** Literal publicado (`VET40`): es la clave de la lista. */
  categoriaRaw: string;
  clasificados: number;
  /** Lectura que manda en esta lista (ver `decidirLecturas`); sin ella, la publicada. */
  fuente?: 'oficial' | 'publicacion';
};

export function sqlGruposNacionales(temporada: string) {
  return sql`
    SELECT v.weapon AS arma, v.gender AS genero, v.category AS categoria, v.category_raw AS "categoriaRaw",
           (SELECT count(*) FROM sport_ranking_entry e WHERE e.publication_id = v.id AND e.position IS NOT NULL) AS clasificados,
           v.fetched_at AS lectura
    FROM (${vigentes(temporada)}) v`;
}

export function sqlGruposOficiales(temporada: string) {
  return sql`
    SELECT weapon AS arma, gender AS genero, min(category) AS categoria, category_raw AS "categoriaRaw",
           count(position) AS clasificados, max(updated_at) AS lectura
    FROM official_ranking_entry WHERE season_label = ${temporada}
    GROUP BY weapon, gender, category_raw`;
}

const ORDEN_ARMA: Record<string, number> = { ESPADA: 0, FLORETE: 1, SABLE: 2 };

export function ordenarGrupos(grupos: GrupoNacional[]): GrupoNacional[] {
  return [...grupos].sort((a, b) =>
    (ORDEN_ARMA[a.arma] ?? 9) - (ORDEN_ARMA[b.arma] ?? 9)
    || (a.genero === b.genero ? 0 : a.genero === 'M' ? -1 : 1)
    || ordenCategoriaVisible(a.categoria) - ordenCategoriaVisible(b.categoria)
    || a.categoriaRaw.localeCompare(b.categoriaRaw));
}

type GrupoLeido = GrupoNacional & { lectura: number | null };

export async function listarGruposNacionales(db: Ejecutor, temporada: string): Promise<GrupoNacional[]> {
  const [publicados, oficiales, listasOficiales] = await Promise.all([
    db.execute(sqlGruposNacionales(temporada)).then((r) => filasDe<GrupoLeido>(r)),
    db.execute(sqlGruposOficiales(temporada)).then((r) => filasDe<GrupoLeido>(r)),
    db.execute(SQL_LISTAS_OFICIALES).then((r) => filasDe<ListaLeida>(r)),
  ]);
  const comoLista = (g: GrupoLeido): ListaLeida => ({ ...g, temporada, clasificados: Number(g.clasificados), lectura: g.lectura });
  const lecturas = decidirLecturas(listasOficiales, publicados.map(comoLista), null);
  const porLista = new Map<string, GrupoNacional>();
  for (const g of publicados) if (!lecturas.ganaOficial(comoLista(g))) porLista.set(claveListaNacional(comoLista(g)), { ...g, fuente: 'publicacion' });
  for (const g of oficiales) if (lecturas.ganaOficial(comoLista(g))) porLista.set(claveListaNacional(comoLista(g)), { ...g, fuente: 'oficial' });
  const grupos = [...porLista.values()]
    .map(({ arma, genero, categoria, categoriaRaw, clasificados, fuente }) => ({ arma, genero, categoria, categoriaRaw, clasificados: Number(clasificados), fuente }))
    // Una lista publicada sin nadie clasificado no aporta nada que mirar.
    .filter((g) => g.clasificados > 0);
  return ordenarGrupos(grupos);
}

/**
 * El grupo pedido si existe; si no, el más parecido (misma arma y género, o
 * misma arma), y si nada encaja, el primero. Nunca uno inventado.
 */
export function elegirGrupo(
  grupos: readonly GrupoNacional[],
  f: Pick<FiltroRankingNacional, 'arma' | 'genero' | 'categoria'>,
): GrupoNacional | null {
  const encaja = (g: GrupoNacional, campos: ('arma' | 'genero' | 'categoria')[]) =>
    campos.every((c) => f[c] === null || (c === 'categoria' ? g.categoriaRaw === f.categoria : g[c] === f[c]));
  return grupos.find((g) => encaja(g, ['arma', 'genero', 'categoria']))
    ?? grupos.find((g) => encaja(g, ['arma', 'genero']) && g.categoria === 'ABS')
    ?? grupos.find((g) => encaja(g, ['arma', 'genero']))
    ?? grupos.find((g) => encaja(g, ['arma']))
    ?? grupos[0]
    ?? null;
}

export type FilaNacional = {
  puesto: number | null;
  nombre: string | null;
  puntos: number | null;
  /** Persona de Explorar, si la fila está vinculada. */
  personaId: string | null;
};

export type TablaNacional = { grupo: GrupoNacional; temporada: string; filas: FilaNacional[] };

export function sqlTablaNacional(temporada: string, g: Pick<GrupoNacional, 'arma' | 'genero' | 'categoriaRaw'>) {
  return sql`
    SELECT e.position AS puesto, e.source_name AS nombre, e.points AS puntos,
           coalesce(per.merged_into_person_id, e.person_id) AS "personaId"
    FROM (${vigentes(temporada)}) v
    JOIN sport_ranking_entry e ON e.publication_id = v.id
    LEFT JOIN sport_person per ON per.id = e.person_id
    WHERE v.weapon = ${g.arma} AND v.gender = ${g.genero} AND v.category_raw = ${g.categoriaRaw}
      AND e.position IS NOT NULL
    ORDER BY e.position ASC, e.source_name ASC
    LIMIT 600`;
}

/** La lista leída de la tabla oficial, con la persona de cada fila por id estable. */
export function sqlTablaNacionalOficial(temporada: string, g: Pick<GrupoNacional, 'arma' | 'genero' | 'categoriaRaw'>) {
  return sql`
    SELECT t.puesto, t.nombre, t.puntos, coalesce(per.merged_into_person_id, t.persona) AS "personaId"
    FROM (
      SELECT o.position AS puesto, o.source_athlete_name AS nombre, o.total_points AS puntos,
             ${personaDeFilaOficial} AS persona
      FROM official_ranking_entry o
      WHERE o.season_label = ${temporada} AND o.weapon = ${g.arma} AND o.gender = ${g.genero}
        AND o.category_raw = ${g.categoriaRaw} AND o.position IS NOT NULL
    ) t
    LEFT JOIN sport_person per ON per.id = t.persona
    ORDER BY t.puesto ASC, t.nombre ASC
    LIMIT 600`;
}

export async function leerTablaNacional(db: Ejecutor, temporada: string, grupo: GrupoNacional): Promise<TablaNacional> {
  const consulta = grupo.fuente === 'oficial' ? sqlTablaNacionalOficial(temporada, grupo) : sqlTablaNacional(temporada, grupo);
  const filas = filasDe<{ puesto: number | null; nombre: string | null; puntos: string | null; personaId: string | null }>(
    await db.execute(consulta),
  ).map((f) => {
    const puntos = f.puntos === null ? null : Number(f.puntos);
    return {
      puesto: f.puesto === null ? null : Number(f.puesto),
      nombre: f.nombre,
      puntos: puntos !== null && Number.isFinite(puntos) ? puntos : null,
      personaId: f.personaId,
    };
  });
  return { grupo, temporada, filas };
}

// ----------------------------------------- Temporada vigente, por grupo ---

/**
 * Los grupos de la clasificación oficial vigente (`official_ranking_entry`),
 * con cuántas filas tiene cada uno. Es lo único de la tabla nacional que va
 * entero a la pantalla: la tabla de cada grupo se pide aparte
 * (`leerTablaOficialVigente`). Mismo orden y misma temporada que
 * `getRankingOficialScreenData`: la más reciente que trae la fuente.
 */
export const SQL_GRUPOS_OFICIALES_VIGENTES = sql`
  SELECT season_label AS temporada, weapon, gender, category, count(*) AS tiradores
  FROM official_ranking_entry
  WHERE season_label = (SELECT max(season_label) FROM official_ranking_entry)
  GROUP BY season_label, weapon, gender, category
  ORDER BY weapon, category, gender`;

export type GruposOficialesVigentes = {
  seasonLabel: string | null;
  groups: (RankingGroupKey & { tiradores: number })[];
};

export async function leerGruposOficialesVigentes(db: Ejecutor): Promise<GruposOficialesVigentes> {
  const filas = filasDe<{ temporada: string; weapon: string; gender: string; category: string; tiradores: number }>(
    await db.execute(SQL_GRUPOS_OFICIALES_VIGENTES),
  );
  return {
    seasonLabel: filas[0]?.temporada ?? null,
    groups: filas.map((f) => ({
      weapon: f.weapon as RankingGroupKey['weapon'],
      gender: f.gender as RankingGroupKey['gender'],
      category: f.category as RankingGroupKey['category'],
      tiradores: Number(f.tiradores),
    })),
  };
}

/**
 * Las filas de UN grupo de la clasificación oficial, con la persona de cada
 * una en la misma sentencia (`personaDeFilaOficial`). Antes la persona se
 * buscaba para las ~1.350 filas de la temporada en cada visita (35-120 ms de
 * motor y ~14.000 filas leídas); ahora sólo para las del grupo que se mira, y
 * el resultado va a la caché compartida.
 */
export function sqlTablaOficialVigente(temporada: string, g: RankingGroupKey) {
  return sql`
    SELECT o.id, o.position, o.total_points AS "totalPoints", o.source_athlete_name AS nombre,
           o.source_club AS club, o.source_birth_date AS nacimiento, o.athlete_id AS "athleteId",
           o.source_url AS "sourceUrl", o.updated_at AS "updatedAt", ${personaDeFilaOficial} AS persona
    FROM official_ranking_entry o
    WHERE o.season_label = ${temporada} AND o.weapon = ${g.weapon} AND o.gender = ${g.gender} AND o.category = ${g.category}
    ORDER BY o.position ASC NULLS LAST, o.source_athlete_name ASC`;
}

export type TablaOficialVigente = {
  tabla: TablaOficial;
  /** `athleteId` → distancia al corte, medida sobre el puesto oficial. */
  cortes: Record<string, CutoffStatus>;
  /** Fila → persona deportiva. */
  personas: Record<string, string>;
};

type FilaOficialLeida = {
  id: string;
  position: number | null;
  totalPoints: string | null;
  nombre: string;
  club: string | null;
  nacimiento: string | null;
  athleteId: string | null;
  sourceUrl: string | null;
  updatedAt: number | string | null;
  persona: string | null;
};

/**
 * Una tabla de la clasificación oficial vigente, con su normativa y la
 * distancia al corte. Hace por grupo lo mismo que `getRankingOficialScreenData`
 * hace para todos (si se toca la regla allí, se toca aquí).
 */
export async function leerTablaOficialVigente(
  db: Ejecutor,
  temporada: string,
  grupo: RankingGroupKey,
  hoy: string,
): Promise<TablaOficialVigente | null> {
  const [filas, temporadaReglas] = await Promise.all([
    db.execute(sqlTablaOficialVigente(temporada, grupo)).then((r) => filasDe<FilaOficialLeida>(r)),
    getRankingSeason(),
  ]);
  if (filas.length === 0) return null;
  const { rules } = temporadaReglas ? await loadRankingRules(temporadaReglas.id) : { rules: [] };
  const regla = pickRule(rules, grupo.weapon, grupo.category);

  const personas: Record<string, string> = {};
  let actualizadoEl: Date | null = null;
  const rows: FilaOficial[] = filas.map((f) => {
    if (f.persona) personas[f.id] = f.persona;
    const leida = f.updatedAt === null ? null : new Date(typeof f.updatedAt === 'number' ? f.updatedAt : Number(f.updatedAt) || f.updatedAt);
    if (leida && !Number.isNaN(leida.getTime()) && (!actualizadoEl || leida > actualizadoEl)) actualizadoEl = leida;
    return {
      id: f.id,
      position: f.position === null ? null : Number(f.position),
      nombre: titular(f.nombre),
      club: f.club,
      totalPoints: f.totalPoints === null ? null : Number.parseFloat(f.totalPoints),
      anioNacimiento: anioNacimientoVisible(f.nacimiento, grupo.category, hoy),
      athleteId: f.athleteId,
    };
  });

  const tabla: TablaOficial = {
    group: { weapon: grupo.weapon, gender: grupo.gender, category: grupo.category },
    seasonLabel: temporada,
    rows,
    clasificados: rows.filter((r) => r.position !== null).length,
    actualizadoEl,
    sourceUrl: filas[0].sourceUrl,
    rule: regla
      ? {
          countingEvents: regla.countingEvents,
          rankingPlaces: regla.rankingPlaces,
          technicalPlaces: regla.technicalPlaces,
          cutoffDate: regla.cutoffDate,
          sourceDocument: regla.sourceDocument,
          sourceUrl: regla.sourceUrl,
        }
      : null,
  };

  const cortes: Record<string, CutoffStatus> = {};
  if (tabla.rule) {
    const clasificados = rows
      .filter((r) => r.position !== null)
      .map((r) => ({ athleteId: r.athleteId ?? r.id, position: r.position as number, totalPoints: r.totalPoints ?? 0 }));
    for (const fila of rows) {
      if (!fila.athleteId || fila.position === null) continue;
      const corte = cutoffStatus(clasificados, fila.athleteId, {
        rankingPlaces: tabla.rule.rankingPlaces,
        technicalPlaces: tabla.rule.technicalPlaces,
        cutoffDate: tabla.rule.cutoffDate,
      });
      if (corte) cortes[fila.athleteId] = corte;
    }
  }
  return { tabla, cortes, personas };
}

/** `athleteId` → persona de Explorar, para el retrato de «tus tiradores». */
export async function personaPorAtleta(db: Ejecutor, athleteIds: readonly string[]): Promise<Record<string, string>> {
  if (athleteIds.length === 0) return {};
  const rows = filasDe<{ atleta: string; id: string }>(await db.execute(sql`
    SELECT athlete_id AS atleta, coalesce(merged_into_person_id, id) AS id FROM sport_person
    WHERE athlete_id IN (SELECT value FROM json_each(${JSON.stringify(athleteIds)}))`));
  const salida: Record<string, string> = {};
  for (const r of rows) salida[r.atleta] ??= r.id;
  return salida;
}

/** Personas de Explorar enlazadas a las fichas de la cuenta, para resaltar «los tuyos». */
export async function personasDeAtletas(db: Ejecutor, athleteIds: readonly string[]): Promise<string[]> {
  if (athleteIds.length === 0) return [];
  const rows = filasDe<{ id: string }>(await db.execute(sql`
    SELECT coalesce(merged_into_person_id, id) AS id FROM sport_person
    WHERE athlete_id IN (SELECT value FROM json_each(${JSON.stringify(athleteIds)}))`));
  return [...new Set(rows.map((r) => r.id))];
}
