import { sql } from 'drizzle-orm';
import { leerRankingOficialDePersonas } from '@/lib/sport/ranking-oficial-db';
import { filas, type ContextoExplorador } from './contexto';
import { aEntradaRanking } from './ficha';
import { listaUuid } from './filtros-sql';
import { ordenCategoriaVisible } from './presentacion';
import type { Arma, EntradaRankingOficial, Genero } from './tipos';

/**
 * Ranking nacional OFICIAL de la RFEE de una persona, temporada a temporada.
 * Hay dos lecturas de la misma clasificación y nunca se mezclan en una lista:
 *
 *   - `official_ranking_entry`, la que mantiene el cron cada día. Manda SIEMPRE
 *     en la temporada vigente (puesto y puntos), aunque haya una publicación
 *     guardada más reciente: la publicación de la vigente sólo sirve para saber
 *     qué persona es cada id de Skermo. Quien ya no está en la tabla oficial no
 *     tiene puesto vigente, figure o no en la publicación.
 *   - `sport_ranking_*` con `source = 'skermo_ranking'` (publicaciones por
 *     temporada). En una temporada cerrada gana, lista a lista, la lectura más
 *     reciente: la tabla oficial si tiene filas de esa lista leídas después
 *     que la publicación; si no, la publicación.
 *
 * De cada lista publicada cuenta sólo la publicación más reciente: si la
 * persona no figura en ella no se le atribuye una lectura anterior. El cálculo
 * interno (`ranking_snapshot`) no se lee aquí nunca.
 */

export const FUENTE_RANKING_NACIONAL = 'skermo_ranking';

export type FilaRankingNacional = {
  temporada: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaRaw: string;
  puesto: number | null;
  puntos: string | null;
  /** Clasificados (con puesto) en esa publicación. */
  clasificados: number;
  /** Cuándo se leyó la lista (ms), para decidir entre lecturas. */
  lectura?: number | null;
};

/** Lista leída (de la tabla oficial o publicada): clave y momento de la lectura. */
export type ListaLeida = {
  temporada: string;
  arma: string;
  genero: string;
  categoriaRaw: string;
  clasificados: number;
  lectura: number | null;
};

export const claveListaNacional = (l: Pick<ListaLeida, 'temporada' | 'arma' | 'genero' | 'categoriaRaw'>) =>
  `${l.temporada}|${l.arma}|${l.genero}|${l.categoriaRaw}`;

/**
 * Filas de la tabla oficial de la persona. Se la reconoce por un id estable,
 * nunca por nombre: el id de Skermo de cualquiera de sus publicaciones (el
 * mismo tirador conserva el id entre temporadas) o una licencia RFEE cuyo
 * enlace más reciente es suyo.
 */
export function sqlOficialDePersonas(ids: readonly string[]) {
  return sql`
    WITH sk AS MATERIALIZED (
      SELECT DISTINCT substr(e.source_ref, 8) AS id
      FROM sport_ranking_entry e CROSS JOIN sport_ranking_publication p ON p.id = e.publication_id
      WHERE e.person_id IN (${listaUuid(ids)}) AND e.source_ref LIKE 'skermo:%'
        AND p.source = ${FUENTE_RANKING_NACIONAL}
    ), lic AS MATERIALIZED (
      SELECT DISTINCT upper(trim(x.value)) AS v FROM sport_external_id x
      WHERE x.person_id IN (${listaUuid(ids)}) AND x.scheme = 'rfee_license' AND x.link_status = 'CONFIRMADO'
        AND NOT EXISTS (
          SELECT 1 FROM sport_external_id y
          WHERE y.scheme = 'rfee_license' AND y.value = x.value AND y.link_status = 'CONFIRMADO'
            AND y.person_id NOT IN (${listaUuid(ids)})
            AND coalesce(y.scope_season, '') > coalesce(x.scope_season, ''))
    )
    SELECT o.season_label AS temporada, o.weapon AS arma, o.gender AS genero, o.category AS categoria,
           o.category_raw AS "categoriaRaw", o.position AS puesto, o.total_points AS puntos,
           o.updated_at AS lectura, o.source_club AS club, o.source_url AS url
    FROM official_ranking_entry o
    WHERE o.skermo_athlete_id IN (SELECT id FROM sk)
       OR (o.source_license IS NOT NULL AND upper(trim(o.source_license)) IN (SELECT v FROM lic))`;
}

/** Listas de la tabla oficial: clasificados y última lectura. ~1.350 filas en total. */
export const SQL_LISTAS_OFICIALES = sql`
  SELECT season_label AS temporada, weapon AS arma, gender AS genero, category_raw AS "categoriaRaw",
         count(position) AS clasificados, max(updated_at) AS lectura
  FROM official_ranking_entry
  GROUP BY season_label, weapon, gender, category_raw`;

/** Última lectura publicada de cada lista de las temporadas que también tiene la tabla oficial. */
export const SQL_LISTAS_PUBLICADAS_CON_OFICIAL = sql`
  SELECT season AS temporada, weapon AS arma, gender AS genero, category_raw AS "categoriaRaw",
         0 AS clasificados, max(fetched_at) AS lectura
  FROM sport_ranking_publication
  WHERE source = ${FUENTE_RANKING_NACIONAL} AND format = 'INDIVIDUAL'
    AND season IN (SELECT DISTINCT season_label FROM official_ranking_entry)
  GROUP BY season, weapon, gender, category_raw`;

export type LecturasNacionales = {
  /** Temporada vigente: la más reciente de la tabla oficial; sin ella, la publicada. */
  vigente: string | null;
  /** Clave de lista (`claveListaNacional`) → la lectura que manda. */
  ganaOficial: (l: Pick<ListaLeida, 'temporada' | 'arma' | 'genero' | 'categoriaRaw'>) => boolean;
};

/**
 * Qué lectura manda en cada lista. Vigente: la tabla oficial, siempre que
 * tenga filas de esa temporada. Cerrada: la más reciente de las dos.
 */
export function decidirLecturas(
  oficiales: readonly ListaLeida[],
  publicadas: readonly ListaLeida[],
  vigentePublicada: string | null,
): LecturasNacionales {
  const vigenteOficial = oficiales.reduce<string | null>((m, l) => (m === null || l.temporada > m ? l.temporada : m), null);
  const oficial = new Map(oficiales.map((l) => [claveListaNacional(l), Number(l.lectura ?? 0)]));
  const publicada = new Map(publicadas.map((l) => [claveListaNacional(l), Number(l.lectura ?? 0)]));
  return {
    vigente: vigenteOficial ?? vigentePublicada,
    ganaOficial: (l) => {
      if (vigenteOficial !== null && l.temporada === vigenteOficial) return true;
      const leidaOficial = oficial.get(claveListaNacional(l));
      if (leidaOficial === undefined) return false;
      const leidaPublicada = publicada.get(claveListaNacional(l));
      return leidaPublicada === undefined || leidaOficial >= leidaPublicada;
    },
  };
}

/**
 * Las filas que cuentan de la persona: de cada lista, las de la lectura que
 * manda. `clasificados` de la tabla oficial sale de sus listas, no de la fila.
 */
export function combinarLecturasNacionales(
  publicadas: readonly FilaRankingNacional[],
  oficiales: readonly FilaRankingNacional[],
  listasOficiales: readonly ListaLeida[],
  lecturas: LecturasNacionales,
): FilaRankingNacional[] {
  const tamano = new Map(listasOficiales.map((l) => [claveListaNacional(l), Number(l.clasificados)]));
  return [
    ...publicadas.filter((f) => !lecturas.ganaOficial(f)),
    ...oficiales.filter((f) => lecturas.ganaOficial(f))
      .map((f) => ({ ...f, clasificados: tamano.get(claveListaNacional(f)) ?? 0 })),
  ];
}

export function sqlRankingNacionalDePersonas(ids: readonly string[]) {
  return sql`
    SELECT p.season AS temporada, p.weapon AS arma, p.gender AS genero, p.category AS categoria,
           p.category_raw AS "categoriaRaw", e.position AS puesto, e.points AS puntos,
           p.fetched_at AS lectura,
           (SELECT count(*) FROM sport_ranking_entry x
             WHERE x.publication_id = p.id AND x.position IS NOT NULL) AS clasificados
    FROM sport_ranking_entry e
    CROSS JOIN sport_ranking_publication p ON p.id = e.publication_id
    WHERE e.person_id IN (${listaUuid(ids)})
      AND p.source = ${FUENTE_RANKING_NACIONAL} AND p.format = 'INDIVIDUAL'
      AND NOT EXISTS (
        SELECT 1 FROM sport_ranking_publication q
        WHERE q.source = p.source AND q.season = p.season AND q.weapon = p.weapon
          AND q.gender = p.gender AND q.category_raw = p.category_raw AND q.format = p.format
          AND (q.published_on > p.published_on
            OR (q.published_on = p.published_on AND q.fetched_at > p.fetched_at)
            OR (q.published_on = p.published_on AND q.fetched_at = p.fetched_at AND q.id > p.id)))
    ORDER BY p.season, p.weapon, p.category_raw`;
}

/** Última temporada publicada del ranking nacional (de cualquiera, no de la persona). */
export const SQL_TEMPORADA_VIGENTE = sql`
  SELECT max(season) AS temporada FROM sport_ranking_publication
  WHERE source = ${FUENTE_RANKING_NACIONAL} AND format = 'INDIVIDUAL'`;

export type PuntoRanking = {
  temporada: string;
  puesto: number | null;
  puntos: number | null;
  de: number;
};

export type ListaRankingNacional = {
  clave: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaRaw: string;
  /** Una por temporada en la que figura, de la más antigua a la más reciente. */
  serie: PuntoRanking[];
  ultimo: PuntoRanking;
  /** Puestos ganados (+) o perdidos (−) frente a la temporada anterior de la misma lista. */
  cambio: number | null;
  /** Sólo figura en una temporada de esta lista. */
  nueva: boolean;
  mejor: PuntoRanking | null;
};

export type RankingNacional = {
  /** Última temporada publicada del ranking nacional. */
  vigente: string | null;
  /** Temporadas en las que figura, ordenadas. */
  temporadas: string[];
  /** Listas de la temporada más reciente en que figura, mejor puesto primero. */
  actuales: ListaRankingNacional[];
  /** Todas las listas en que ha figurado. */
  listas: ListaRankingNacional[];
  mejor: (PuntoRanking & { lista: ListaRankingNacional }) | null;
  /** Temporadas-lista dentro de los diez primeros. */
  top10: number;
};

export const RANKING_NACIONAL_VACIO: RankingNacional = {
  vigente: null, temporadas: [], actuales: [], listas: [], mejor: null, top10: 0,
};

function numero(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Temporada anterior en formato RFEE («2022-2023» → «2021-2022»). */
export function temporadaAnterior(t: string): string | null {
  const m = /^(\d{4})-(\d{4})$/.exec(t);
  return m ? `${Number(m[1]) - 1}-${Number(m[2]) - 1}` : null;
}

const mejorDe = (a: PuntoRanking | null, b: PuntoRanking) =>
  b.puesto === null ? a : a === null || a.puesto === null || b.puesto < a.puesto || (b.puesto === a.puesto && b.temporada > a.temporada) ? b : a;

export function construirRankingNacional(
  rows: readonly FilaRankingNacional[],
  vigente: string | null,
): RankingNacional {
  const porLista = new Map<string, { base: FilaRankingNacional; serie: Map<string, PuntoRanking> }>();
  for (const r of rows) {
    const clave = `${r.arma}|${r.genero}|${r.categoriaRaw}`;
    const lista = porLista.get(clave) ?? { base: r, serie: new Map<string, PuntoRanking>() };
    const puesto = r.puesto === null ? null : Number(r.puesto);
    lista.serie.set(r.temporada, { temporada: r.temporada, puesto, puntos: numero(r.puntos), de: Number(r.clasificados) });
    porLista.set(clave, lista);
  }

  const listas: ListaRankingNacional[] = [...porLista.entries()].map(([clave, { base, serie }]) => {
    const puntos = [...serie.values()].sort((a, b) => a.temporada.localeCompare(b.temporada));
    const ultimo = puntos[puntos.length - 1];
    const previaClave = temporadaAnterior(ultimo.temporada);
    const previa = previaClave ? serie.get(previaClave) ?? null : null;
    return {
      clave,
      arma: base.arma,
      genero: base.genero,
      categoria: base.categoria,
      categoriaRaw: base.categoriaRaw,
      serie: puntos,
      ultimo,
      cambio: previa?.puesto != null && ultimo.puesto !== null ? previa.puesto - ultimo.puesto : null,
      nueva: puntos.length === 1,
      mejor: puntos.reduce<PuntoRanking | null>(mejorDe, null),
    };
  });

  const orden = (a: ListaRankingNacional, b: ListaRankingNacional) =>
    (a.ultimo.puesto ?? Infinity) - (b.ultimo.puesto ?? Infinity)
    || ordenCategoriaVisible(a.categoria) - ordenCategoriaVisible(b.categoria)
    || a.categoriaRaw.localeCompare(b.categoriaRaw)
    || a.arma.localeCompare(b.arma);

  const temporadas = [...new Set(rows.map((r) => r.temporada))].sort();
  const ultimaPropia = temporadas[temporadas.length - 1] ?? null;
  const actuales = listas.filter((l) => l.ultimo.temporada === ultimaPropia).sort(orden);

  let mejor: RankingNacional['mejor'] = null;
  let top10 = 0;
  for (const l of listas) {
    for (const p of l.serie) {
      if (p.puesto !== null && p.puesto <= 10) top10 += 1;
      if (p.puesto !== null && (mejor === null || p.puesto < mejor.puesto! || (p.puesto === mejor.puesto && p.temporada > mejor.temporada))) {
        mejor = { ...p, lista: l };
      }
    }
  }

  return {
    vigente,
    temporadas,
    actuales,
    listas: [...listas].sort((a, b) => b.serie.length - a.serie.length || orden(a, b)),
    mejor,
    top10,
  };
}

/** Última temporada del ranking mundial (FIE) en la que figura la persona. */
export function sqlTemporadaMundial(ids: readonly string[]) {
  return sql`
    SELECT max(p.season) AS temporada
    -- CROSS JOIN fija el orden en SQLite: sin él el planificador recorre todas
    -- las publicaciones FIE por (source) en vez de las pocas filas de la persona.
    FROM sport_ranking_entry e CROSS JOIN sport_ranking_publication p ON p.id = e.publication_id
    WHERE e.person_id IN (${listaUuid(ids)}) AND p.source = 'fie_tiradores' AND p.format = 'INDIVIDUAL'
      AND e.position IS NOT NULL`;
}

/** Puestos de la persona en el ranking mundial de su última temporada; vacío si no figura o falla. */
export async function leerRankingMundial(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<EntradaRankingOficial[]> {
  if (ids.length === 0) return [];
  try {
    const temporada = filas<{ temporada: string | null }>(await db.execute(sqlTemporadaMundial(ids)))[0]?.temporada;
    if (!temporada) return [];
    return (await leerRankingOficialDePersonas(db, ids, temporada, 'INDIVIDUAL'))
      .filter((e) => e.publicacion.source === 'fie_tiradores' && e.position !== null)
      .map(aEntradaRanking);
  } catch {
    return [];
  }
}

/** Mejor puesto internacional (FIE) de la persona por arma y categoría, en toda su carrera. */
export type MejorMundial = {
  arma: Arma; genero: Genero; categoria: string; puesto: number; temporada: string;
  /** Sólo en `actuales`: el id FIE de la fila, para cruzarla con la clasificación olímpica. */
  fieId?: number;
};

export type ResumenMundial = {
  /** Última temporada publicada del ranking FIE (de cualquiera). */
  vigente: string | null;
  mejores: MejorMundial[];
  /**
   * Puestos en la clasificación FIE vigente (`fie_clasificacion`, la que pinta
   * /ranking), por el `fie_addr_id` confirmado de la persona. Ausente en
   * lecturas anteriores.
   */
  actuales?: MejorMundial[];
};

/**
 * Puestos de la persona en `fie_clasificacion` de su última temporada. Entra
 * por la clave (temporada, arma, género, categoría, formato, fie_id) grupo a
 * grupo: la tabla no tiene índice por `fie_id` y recorrer sus ~11.500 filas
 * costaba 90 ms.
 */
export function sqlClasificacionFieDePersonas(ids: readonly string[]) {
  return sql`
    WITH ids AS MATERIALIZED (
      SELECT DISTINCT CAST(x.value AS INTEGER) AS fie FROM sport_external_id x
      WHERE x.scheme = 'fie_addr_id' AND x.link_status = 'CONFIRMADO' AND x.person_id IN (${listaUuid(ids)})
    ), g AS MATERIALIZED (
      SELECT DISTINCT season, weapon, gender, category_raw FROM fie_clasificacion
      WHERE season = (SELECT max(season) FROM fie_clasificacion)
    )
    SELECT f.weapon AS arma, f.gender AS genero, f.category AS categoria, f.position AS puesto,
           CAST(f.season AS TEXT) AS temporada, f.fie_id AS "fieId"
    FROM g CROSS JOIN ids CROSS JOIN fie_clasificacion f
      ON f.season = g.season AND f.weapon = g.weapon AND f.gender = g.gender
     AND f.category_raw = g.category_raw AND f.format = 'INDIVIDUAL' AND f.fie_id = ids.fie
    WHERE f.position IS NOT NULL`;
}

export function sqlMejoresMundiales(ids: readonly string[]) {
  // `min()` con columnas sueltas: SQLite devuelve la temporada de la fila del mínimo.
  return sql`
    SELECT p.weapon AS arma, p.gender AS genero, p.category AS categoria,
           min(e.position) AS puesto, p.season AS temporada
    FROM sport_ranking_entry e CROSS JOIN sport_ranking_publication p ON p.id = e.publication_id
    WHERE e.person_id IN (${listaUuid(ids)}) AND p.source = 'fie_tiradores' AND p.format = 'INDIVIDUAL'
      AND e.position IS NOT NULL
    GROUP BY p.weapon, p.gender, p.category`;
}

export const SQL_TEMPORADA_MUNDIAL_VIGENTE = sql`
  SELECT max(season) AS temporada FROM sport_ranking_publication
  WHERE source = 'fie_tiradores' AND format = 'INDIVIDUAL'`;

export async function leerResumenMundial(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<ResumenMundial> {
  if (ids.length === 0) return { vigente: null, mejores: [] };
  const actuales = db.execute(sqlClasificacionFieDePersonas(ids))
    .then((r) => filas<MejorMundial>(r).map((m) => ({ ...m, puesto: Number(m.puesto), fieId: Number(m.fieId) })))
    .catch(() => [] as MejorMundial[]);
  try {
    const [mejores, vigente] = await Promise.all([db.execute(sqlMejoresMundiales(ids)), db.execute(SQL_TEMPORADA_MUNDIAL_VIGENTE)]);
    return {
      vigente: filas<{ temporada: string | null }>(vigente)[0]?.temporada ?? null,
      mejores: filas<MejorMundial>(mejores).map((m) => ({ ...m, puesto: Number(m.puesto) })),
      actuales: await actuales,
    };
  } catch {
    return { vigente: null, mejores: [], actuales: await actuales };
  }
}

export type PuestoOficialPersona = FilaRankingNacional & { club: string | null; url: string | null };

/**
 * Filas de la temporada vigente de la tabla oficial de unas personas, con el
 * tamaño de cada lista. Para quien no tiene la ficha enlazada por
 * `athlete_id` en la fila (casi nadie la tiene) pero sí una persona.
 */
export async function leerPuestosOficialesVigentes(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<PuestoOficialPersona[]> {
  if (ids.length === 0) return [];
  try {
    const [rows, listas] = await Promise.all([db.execute(sqlOficialDePersonas(ids)), db.execute(SQL_LISTAS_OFICIALES)]);
    const listasLeidas = filas<ListaLeida>(listas);
    const lecturas = decidirLecturas(listasLeidas, [], null);
    const tamano = new Map(listasLeidas.map((l) => [claveListaNacional(l), Number(l.clasificados)]));
    return filas<PuestoOficialPersona>(rows)
      .filter((f) => f.temporada === lecturas.vigente)
      .map((f) => ({ ...f, clasificados: tamano.get(claveListaNacional(f)) ?? 0 }));
  } catch {
    return [];
  }
}

/** Lectura completa; cualquier fallo devuelve el ranking vacío (el bloque no se pinta). */
export async function leerRankingNacional(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<RankingNacional> {
  if (ids.length === 0) return RANKING_NACIONAL_VACIO;
  try {
    const [publicadas, vigente, oficiales, listasOficiales, listasPublicadas] = await Promise.all([
      db.execute(sqlRankingNacionalDePersonas(ids)),
      db.execute(SQL_TEMPORADA_VIGENTE),
      db.execute(sqlOficialDePersonas(ids)),
      db.execute(SQL_LISTAS_OFICIALES),
      db.execute(SQL_LISTAS_PUBLICADAS_CON_OFICIAL),
    ]);
    const listas = filas<ListaLeida>(listasOficiales);
    const lecturas = decidirLecturas(listas, filas<ListaLeida>(listasPublicadas), filas<{ temporada: string | null }>(vigente)[0]?.temporada ?? null);
    return construirRankingNacional(
      combinarLecturasNacionales(filas<FilaRankingNacional>(publicadas), filas<FilaRankingNacional>(oficiales), listas, lecturas),
      lecturas.vigente,
    );
  } catch {
    return RANKING_NACIONAL_VACIO;
  }
}
