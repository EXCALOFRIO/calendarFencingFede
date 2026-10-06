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
