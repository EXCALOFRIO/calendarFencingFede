import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import {
  athlete as athleteTable,
  club as clubTable,
  eventCompetition as eventCompetitionTable,
  event as eventTable,
  fieFencer as fieFencerTable,
  fieWorldRanking as fieWorldRankingTable,
  officialRankingEntry as officialRankingEntryTable,
  rankingPoint as rankingPointTable,
  rankingSnapshot as rankingSnapshotTable,
  result as resultTable,
  season as seasonTable,
} from '@/db/schema';
import {
  type CutoffStatus,
  type Gender,
  type RankingCategory,
  type Weapon,
  cutoffStatus,
  loadRankingRules,
  pickRule,
} from '../ranking/compute';
import { fotoFieAncho } from '../ingest/sources/fie-tiradores';
import { titular, yearFromIsoDate } from '../utils';

/**
 * Consultas de la pantalla de ranking.
 *
 * Todas leen de `ranking_snapshot` y `ranking_point`, nunca recalculan: la
 * pantalla enseña lo último que se calculó, con su fecha, y no se pone a
 * sumar puntos mientras alguien mira. Si el cálculo está viejo, se dice; lo
 * que no se hace es disimularlo recalculando por debajo.
 *
 * Igual que en el calendario, se lanzan varias consultas pequeñas y se cose en
 * memoria en vez de un JOIN grande: con Neon por HTTP lo caro es el viaje de
 * red, y un JOIN devuelve la misma fila de tirador repetida una vez por cada
 * prueba suya.
 */

export type RankingGroupKey = {
  weapon: Weapon;
  gender: Gender;
  category: RankingCategory;
};

export type RankingRowView = RankingGroupKey & {
  athleteId: string;
  athleteName: string;
  clubName: string | null;
  position: number;
  totalPoints: number;
  countedEvents: number;
  /** Puestos ganados (+) o perdidos (−) desde el cálculo anterior. Null si es
   *  el primero: "sin variación" y "no hay con qué comparar" no son lo mismo. */
  change: number | null;
};

export type RankingTableView = {
  group: RankingGroupKey;
  rows: RankingRowView[];
  computedAt: Date | null;
  previousComputedAt: Date | null;
  /** Normativa aplicada, para poder enseñar de dónde salen los números. */
  rule: {
    countingEvents: number;
    rankingPlaces: number;
    technicalPlaces: number;
    cutoffDate: Date | null;
    sourceDocument: string | null;
    sourceUrl: string | null;
  } | null;
};

/** Temporada actual. Sin ella no hay ranking que enseñar. */
export const getRankingSeason = cache(async () => {
  const [row] = await db
    .select()
    .from(seasonTable)
    .where(eq(seasonTable.current, true))
    .limit(1);
  return row ?? null;
});

/**
 * Estado real del ranking, para que la pantalla pueda ser HONESTA cuando está
 * vacía en vez de enseñar una tabla de mentira.
 *
 * Distingue los cuatro motivos por los que puede no haber ranking, porque cada
 * uno se arregla de una forma distinta y decir "no hay datos" no ayuda a
 * nadie: falta la temporada, falta la normativa, faltan resultados, o hay
 * resultados pero nadie ha lanzado el cálculo.
 */
export const getRankingStatus = cache(async () => {
  const season = await getRankingSeason();

  if (!season) {
    return {
      season: null,
      hasRules: false,
      invalidRules: [],
      resultsTotal: 0,
      resultsMatched: 0,
      resultsUnmatched: 0,
      snapshotCount: 0,
      lastComputedAt: null as Date | null,
    };
  }

  const { rules, invalid } = await loadRankingRules(season.id);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      matched: sql<number>`count(${resultTable.athleteId})::int`,
    })
    .from(resultTable);

  const [snapshot] = await db
    .select({
      count: sql<number>`count(*)::int`,
      lastComputedAt: sql<Date | null>`max(${rankingSnapshotTable.computedAt})`,
    })
    .from(rankingSnapshotTable)
    .where(eq(rankingSnapshotTable.seasonId, season.id));

  return {
    season,
    hasRules: rules.length > 0,
    invalidRules: invalid,
    resultsTotal: counts?.total ?? 0,
    resultsMatched: counts?.matched ?? 0,
    resultsUnmatched: (counts?.total ?? 0) - (counts?.matched ?? 0),
    snapshotCount: snapshot?.count ?? 0,
    lastComputedAt: snapshot?.lastComputedAt ?? null,
  };
});

/** Las dos últimas fechas de cálculo: la actual y la de referencia. */
async function lastTwoComputedAt(seasonId: string): Promise<(Date | null)[]> {
  const rows = await db
    .selectDistinct({ computedAt: rankingSnapshotTable.computedAt })
    .from(rankingSnapshotTable)
    .where(eq(rankingSnapshotTable.seasonId, seasonId))
    .orderBy(desc(rankingSnapshotTable.computedAt))
    .limit(2);
  return [rows[0]?.computedAt ?? null, rows[1]?.computedAt ?? null];
}

/**
 * Combinaciones arma/género/categoría que tienen ranking calculado.
 *
 * Los selectores de la pantalla se construyen con ESTO, no con la lista
 * completa de armas y categorías: ofrecer "Sable M9 femenino" para que al
 * tocarlo salga vacío es una promesa incumplida en cada toque.
 */
export const listRankingGroups = cache(
  async (): Promise<(RankingGroupKey & { athletes: number })[]> => {
    const season = await getRankingSeason();
    if (!season) return [];

    const [computedAt] = await lastTwoComputedAt(season.id);
    if (!computedAt) return [];

    const rows = await db
      .select({
        weapon: rankingSnapshotTable.weapon,
        gender: rankingSnapshotTable.gender,
        category: rankingSnapshotTable.category,
        athletes: sql<number>`count(*)::int`,
      })
      .from(rankingSnapshotTable)
      .where(
        and(
          eq(rankingSnapshotTable.seasonId, season.id),
          eq(rankingSnapshotTable.computedAt, computedAt),
        ),
      )
      .groupBy(
        rankingSnapshotTable.weapon,
        rankingSnapshotTable.gender,
        rankingSnapshotTable.category,
      )
      .orderBy(
        asc(rankingSnapshotTable.weapon),
        asc(rankingSnapshotTable.category),
        asc(rankingSnapshotTable.gender),
      );

    return rows.map((r) => ({
      weapon: r.weapon as Weapon,
      gender: r.gender as Gender,
      category: r.category as RankingCategory,
      athletes: r.athletes,
    }));
  },
);

/** La tabla de un arma/género/categoría, con el movimiento desde el cálculo anterior. */
export async function getRankingTable(
  group: RankingGroupKey,
): Promise<RankingTableView> {
  const season = await getRankingSeason();
  const empty: RankingTableView = {
    group,
    rows: [],
    computedAt: null,
    previousComputedAt: null,
    rule: null,
  };
  if (!season) return empty;

  const [computedAt, previousComputedAt] = await lastTwoComputedAt(season.id);
  if (!computedAt) return empty;

  const where = (at: Date) =>
    and(
      eq(rankingSnapshotTable.seasonId, season.id),
      eq(rankingSnapshotTable.computedAt, at),
      eq(rankingSnapshotTable.weapon, group.weapon),
      eq(rankingSnapshotTable.gender, group.gender),
      eq(rankingSnapshotTable.category, group.category),
    );

  const [current, previous, { rules }] = await Promise.all([
    db
      .select({
        athleteId: rankingSnapshotTable.athleteId,
        position: rankingSnapshotTable.position,
        totalPoints: rankingSnapshotTable.totalPoints,
        countedEventIds: rankingSnapshotTable.countedEventIds,
        firstName: athleteTable.firstName,
        lastName: athleteTable.lastName,
        clubName: clubTable.name,
      })
      .from(rankingSnapshotTable)
      .innerJoin(athleteTable, eq(athleteTable.id, rankingSnapshotTable.athleteId))
      .leftJoin(clubTable, eq(clubTable.id, athleteTable.clubId))
      .where(where(computedAt))
      .orderBy(asc(rankingSnapshotTable.position)),
    previousComputedAt
      ? db
          .select({
            athleteId: rankingSnapshotTable.athleteId,
            position: rankingSnapshotTable.position,
          })
          .from(rankingSnapshotTable)
          .where(where(previousComputedAt))
      : Promise.resolve([] as { athleteId: string; position: number }[]),
    loadRankingRules(season.id),
  ]);

  const previousByAthlete = new Map(previous.map((p) => [p.athleteId, p.position]));
  const rule = pickRule(rules, group.weapon, group.category);

  return {
    group,
    computedAt,
    previousComputedAt,
    rule: rule
      ? {
          countingEvents: rule.countingEvents,
          rankingPlaces: rule.rankingPlaces,
          technicalPlaces: rule.technicalPlaces,
          cutoffDate: rule.cutoffDate,
          sourceDocument: rule.sourceDocument,
          sourceUrl: rule.sourceUrl,
        }
      : null,
    rows: current.map((row) => {
      const before = previousByAthlete.get(row.athleteId);
      return {
        ...group,
        athleteId: row.athleteId,
        athleteName: `${row.firstName} ${row.lastName}`.trim(),
        clubName: row.clubName,
        position: row.position,
        totalPoints: Number.parseFloat(row.totalPoints),
        countedEvents: Array.isArray(row.countedEventIds)
          ? row.countedEventIds.length
          : 0,
        // Subir en el ranking es bajar de número: se invierte para que el
        // signo signifique lo que la gente espera.
        change: before === undefined ? null : before - row.position,
      };
    }),
  };
}

export type BreakdownEntry = {
  eventCompetitionId: string;
  eventName: string;
  eventCity: string | null;
  eventDate: string | null;
  circuit: string;
  position: number;
  basePoints: number;
  coefficient: number;
  finalPoints: number;
  counted: boolean;
  explanation: string | null;
};

export type AthleteBreakdown = {
  athleteId: string;
  athleteName: string;
  clubName: string | null;
  group: RankingGroupKey;
  position: number;
  totalPoints: number;
  entries: BreakdownEntry[];
  cutoff: CutoffStatus | null;
  rule: RankingTableView['rule'];
  computedAt: Date | null;
};

/**
 * El cálculo abierto de un tirador: qué pruebas se han cogido, con qué
 * coeficiente y por qué. Es lo que se enseña al tocar una fila.
 *
 * Se devuelven TODAS sus pruebas, también las que no cuentan, porque la
 * pregunta que trae aquí a la gente casi siempre es la contraria: no "¿de
 * dónde salen mis puntos?", sino "¿por qué no me cuenta aquella prueba?".
 */
export async function getAthleteBreakdown(
  athleteId: string,
  group: RankingGroupKey,
): Promise<AthleteBreakdown | null> {
  const season = await getRankingSeason();
  if (!season) return null;

  const [computedAt] = await lastTwoComputedAt(season.id);
  if (!computedAt) return null;

  const [snapshot] = await db
    .select({
      position: rankingSnapshotTable.position,
      totalPoints: rankingSnapshotTable.totalPoints,
      firstName: athleteTable.firstName,
      lastName: athleteTable.lastName,
      clubName: clubTable.name,
    })
    .from(rankingSnapshotTable)
    .innerJoin(athleteTable, eq(athleteTable.id, rankingSnapshotTable.athleteId))
    .leftJoin(clubTable, eq(clubTable.id, athleteTable.clubId))
    .where(
      and(
        eq(rankingSnapshotTable.seasonId, season.id),
        eq(rankingSnapshotTable.computedAt, computedAt),
        eq(rankingSnapshotTable.athleteId, athleteId),
        eq(rankingSnapshotTable.weapon, group.weapon),
        eq(rankingSnapshotTable.gender, group.gender),
        eq(rankingSnapshotTable.category, group.category),
      ),
    )
    .limit(1);

  if (!snapshot) return null;

  const [points, table] = await Promise.all([
    db
      .select({
        eventCompetitionId: rankingPointTable.eventCompetitionId,
        position: rankingPointTable.position,
        basePoints: rankingPointTable.basePoints,
        coefficient: rankingPointTable.coefficient,
        finalPoints: rankingPointTable.finalPoints,
        counted: rankingPointTable.counted,
        explanation: rankingPointTable.explanation,
        weapon: eventCompetitionTable.weapon,
        gender: eventCompetitionTable.gender,
        category: eventCompetitionTable.category,
        competitionDate: eventCompetitionTable.competitionDate,
        eventName: eventTable.name,
        eventCity: eventTable.city,
        eventStartDate: eventTable.startDate,
        circuit: eventTable.circuit,
      })
      .from(rankingPointTable)
      .innerJoin(
        eventCompetitionTable,
        eq(eventCompetitionTable.id, rankingPointTable.eventCompetitionId),
      )
      .innerJoin(eventTable, eq(eventTable.id, eventCompetitionTable.eventId))
      .where(
        and(
          eq(rankingPointTable.seasonId, season.id),
          eq(rankingPointTable.athleteId, athleteId),
        ),
      )
      .orderBy(desc(rankingPointTable.finalPoints)),
    getRankingTable(group),
  ]);

  const entries = points
    // Un tirador puede estar en varios rankings (M17 y ABS): aquí solo van las
    // pruebas del ranking que se está mirando.
    .filter(
      (p) =>
        p.weapon === group.weapon &&
        p.gender === group.gender &&
        p.category === group.category,
    )
    .map<BreakdownEntry>((p) => ({
      eventCompetitionId: p.eventCompetitionId,
      eventName: p.eventName,
      eventCity: p.eventCity,
      eventDate: isoDate(p.competitionDate) ?? isoDate(p.eventStartDate),
      circuit: p.circuit,
      position: p.position,
      basePoints: Number.parseFloat(p.basePoints),
      coefficient: Number.parseFloat(p.coefficient),
      finalPoints: Number.parseFloat(p.finalPoints),
      counted: p.counted === '1',
      explanation: p.explanation,
    }));

  const cutoff = table.rule
    ? cutoffStatus(
        table.rows.map((r) => ({
          athleteId: r.athleteId,
          position: r.position,
          totalPoints: r.totalPoints,
        })),
        athleteId,
        {
          rankingPlaces: table.rule.rankingPlaces,
          technicalPlaces: table.rule.technicalPlaces,
          cutoffDate: table.rule.cutoffDate,
        },
      )
    : null;

  return {
    athleteId,
    athleteName: `${snapshot.firstName} ${snapshot.lastName}`.trim(),
    clubName: snapshot.clubName,
    group,
    position: snapshot.position,
    totalPoints: Number.parseFloat(snapshot.totalPoints),
    entries,
    cutoff,
    rule: table.rule,
    computedAt,
  };
}

export type RankingHistoryPoint = {
  computedAt: Date;
  position: number;
  totalPoints: number;
};

/**
 * Evolución de un tirador a lo largo de la temporada, un punto por cálculo.
 * Es lo que permite contestar "¿cuánto me movió esta competición?" con un
 * dato y no con una impresión.
 */
export async function getAthleteRankingHistory(
  athleteId: string,
  group: RankingGroupKey,
): Promise<RankingHistoryPoint[]> {
  const season = await getRankingSeason();
  if (!season) return [];

  const rows = await db
    .select({
      computedAt: rankingSnapshotTable.computedAt,
      position: rankingSnapshotTable.position,
      totalPoints: rankingSnapshotTable.totalPoints,
    })
    .from(rankingSnapshotTable)
    .where(
      and(
        eq(rankingSnapshotTable.seasonId, season.id),
        eq(rankingSnapshotTable.athleteId, athleteId),
        eq(rankingSnapshotTable.weapon, group.weapon),
        eq(rankingSnapshotTable.gender, group.gender),
        eq(rankingSnapshotTable.category, group.category),
      ),
    )
    .orderBy(asc(rankingSnapshotTable.computedAt));

  return rows.map((r) => ({
    computedAt: r.computedAt,
    position: r.position,
    totalPoints: Number.parseFloat(r.totalPoints),
  }));
}

/**
 * Resultados leídos de la fuente que todavía no tienen tirador asignado.
 *
 * No se emparejan por nombre nunca —hay homónimos y los acentos van a su aire
 * entre fuentes—, así que esta cola la resuelve una persona con un clic. Sale
 * en el panel de admin y también, contada, debajo del ranking: si hay 40
 * resultados sin emparejar, la tabla que estás mirando está incompleta y eso
 * hay que decirlo.
 */
export async function listUnmatchedResults(limit = 100) {
  return db
    .select({
      id: resultTable.id,
      sourceAthleteName: resultTable.sourceAthleteName,
      sourceLicense: resultTable.sourceLicense,
      sourceClub: resultTable.sourceClub,
      position: resultTable.position,
      weapon: resultTable.weapon,
      gender: resultTable.gender,
      category: resultTable.category,
      sourceUrl: resultTable.sourceUrl,
      eventName: eventTable.name,
      eventStartDate: eventTable.startDate,
    })
    .from(resultTable)
    .leftJoin(eventTable, eq(eventTable.id, resultTable.eventId))
    .where(isNull(resultTable.athleteId))
    .orderBy(desc(resultTable.ingestedAt))
    .limit(limit);
}

/** Rankings en los que aparece un tirador concreto (puede estar en varios). */
export async function listGroupsForAthlete(
  athleteId: string,
): Promise<RankingGroupKey[]> {
  const season = await getRankingSeason();
  if (!season) return [];

  const [computedAt] = await lastTwoComputedAt(season.id);
  if (!computedAt) return [];

  const rows = await db
    .select({
      weapon: rankingSnapshotTable.weapon,
      gender: rankingSnapshotTable.gender,
      category: rankingSnapshotTable.category,
    })
    .from(rankingSnapshotTable)
    .where(
      and(
        eq(rankingSnapshotTable.seasonId, season.id),
        eq(rankingSnapshotTable.computedAt, computedAt),
        eq(rankingSnapshotTable.athleteId, athleteId),
      ),
    );

  return rows.map((r) => ({
    weapon: r.weapon as Weapon,
    gender: r.gender as Gender,
    category: r.category as RankingCategory,
  }));
}

/** Nombres de los tiradores de una tanda, para etiquetas sueltas. */
export async function athleteNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: athleteTable.id,
      firstName: athleteTable.firstName,
      lastName: athleteTable.lastName,
    })
    .from(athleteTable)
    .where(inArray(athleteTable.id, ids));
  return new Map(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]));
}

/** Clave de grupo en los diccionarios que viajan a la pantalla. */
export function groupKey(group: RankingGroupKey): string {
  return `${group.weapon}|${group.gender}|${group.category}`;
}

export type RankingScreenData = {
  status: Awaited<ReturnType<typeof getRankingStatus>>;
  groups: (RankingGroupKey & { athletes: number })[];
  /** Tabla por grupo, indexada por `groupKey`. */
  tables: Record<string, RankingTableView>;
  /** `grupo` -> `athleteId` -> a cuántos puestos está del corte. */
  cutoffs: Record<string, Record<string, CutoffStatus>>;
  /** `grupo|athleteId` -> desglose completo del cálculo. */
  breakdowns: Record<string, BreakdownEntry[]>;
};

/**
 * Todo lo que la pantalla de ranking necesita, en una sola pasada.
 *
 * Se carga entero en el servidor y se manda al cliente, igual que el
 * calendario, por el mismo motivo: en un pabellón con mala cobertura, cambiar
 * de arma o abrir el desglose de un tirador no puede depender de un viaje a
 * la red. El volumen lo permite de sobra: un club son decenas de tiradores y
 * unos cientos de filas de puntos, no millones.
 */
export async function getRankingScreenData(): Promise<RankingScreenData> {
  const status = await getRankingStatus();
  const empty: RankingScreenData = {
    status,
    groups: [],
    tables: {},
    cutoffs: {},
    breakdowns: {},
  };

  if (!status.season || status.snapshotCount === 0) return empty;

  const groups = await listRankingGroups();
  if (groups.length === 0) return empty;

  const tables: Record<string, RankingTableView> = {};
  const cutoffs: Record<string, Record<string, CutoffStatus>> = {};

  for (const group of groups) {
    const key = groupKey(group);
    const table = await getRankingTable(group);
    tables[key] = table;

    cutoffs[key] = {};
    if (table.rule) {
      const simple = table.rows.map((r) => ({
        athleteId: r.athleteId,
        position: r.position,
        totalPoints: r.totalPoints,
      }));
      for (const row of table.rows) {
        const corte = cutoffStatus(simple, row.athleteId, {
          rankingPlaces: table.rule.rankingPlaces,
          technicalPlaces: table.rule.technicalPlaces,
          cutoffDate: table.rule.cutoffDate,
        });
        if (corte) cutoffs[key][row.athleteId] = corte;
      }
    }
  }

  // Los desgloses van en UNA consulta para toda la temporada: uno por tirador
  // serían decenas de viajes a Neon para pintar la misma pantalla.
  const points = await db
    .select({
      athleteId: rankingPointTable.athleteId,
      eventCompetitionId: rankingPointTable.eventCompetitionId,
      position: rankingPointTable.position,
      basePoints: rankingPointTable.basePoints,
      coefficient: rankingPointTable.coefficient,
      finalPoints: rankingPointTable.finalPoints,
      counted: rankingPointTable.counted,
      explanation: rankingPointTable.explanation,
      weapon: eventCompetitionTable.weapon,
      gender: eventCompetitionTable.gender,
      category: eventCompetitionTable.category,
      competitionDate: eventCompetitionTable.competitionDate,
      eventName: eventTable.name,
      eventCity: eventTable.city,
      eventStartDate: eventTable.startDate,
      circuit: eventTable.circuit,
    })
    .from(rankingPointTable)
    .innerJoin(
      eventCompetitionTable,
      eq(eventCompetitionTable.id, rankingPointTable.eventCompetitionId),
    )
    .innerJoin(eventTable, eq(eventTable.id, eventCompetitionTable.eventId))
    .where(eq(rankingPointTable.seasonId, status.season.id))
    .orderBy(desc(rankingPointTable.finalPoints));

  const breakdowns: Record<string, BreakdownEntry[]> = {};
  for (const p of points) {
    const key = `${p.weapon}|${p.gender}|${p.category}|${p.athleteId}`;
    const list = breakdowns[key] ?? [];
    list.push({
      eventCompetitionId: p.eventCompetitionId,
      eventName: p.eventName,
      eventCity: p.eventCity,
      eventDate: isoDate(p.competitionDate) ?? isoDate(p.eventStartDate),
      circuit: p.circuit,
      position: p.position,
      basePoints: Number.parseFloat(p.basePoints),
      coefficient: Number.parseFloat(p.coefficient),
      finalPoints: Number.parseFloat(p.finalPoints),
      counted: p.counted === '1',
      explanation: p.explanation,
    });
    breakdowns[key] = list;
  }

  return { status, groups, tables, cutoffs, breakdowns };
}

// ------------------------------------ Ranking OFICIAL de la RFEE (Skermo) ---

/**
 * La clasificación oficial de la RFEE, que es distinta del cálculo interno.
 *
 * Son dos números y confundirlos sería grave, así que viven en funciones
 * separadas con nombres separados y la interfaz tiene que decir cuál es cuál:
 *
 *   - el OFICIAL (`official_ranking_entry`) es el que publica la federación y
 *     el que decide convocatorias. Es el que la gente reconoce y el que se
 *     enseña primero. Hoy son 1.235 filas y 808 tiradores.
 *   - el INTERNO (`ranking_snapshot` / `ranking_point`) es el que esta
 *     aplicación calcula y puede abrir puesto a puesto. Sirve para auditar y
 *     para contestar «¿por qué no me cuenta aquella prueba?», y solo existe
 *     para los tiradores cuyos resultados están emparejados.
 *
 * El oficial NO se recalcula ni se retoca: se enseña tal y como se leyó, con la
 * fecha de la última lectura y el enlace a la página de la que salió.
 */

export type FilaOficial = {
  /** Fila de `official_ranking_entry`, no de `athlete`. */
  id: string;
  /** `null` cuando el tirador todavía no está clasificado. */
  position: number | null;
  nombre: string;
  /** Código del club tal y como lo publica Skermo («FED-M-C»). */
  club: string | null;
  totalPoints: number | null;
  anioNacimiento: number | null;
  /** Ficha de esta aplicación, si la fila está emparejada por licencia. */
  athleteId: string | null;
};

export type TablaOficial = {
  group: RankingGroupKey;
  seasonLabel: string;
  rows: FilaOficial[];
  /** Cuántos tienen puesto. El resto aparecen en la fuente pero sin clasificar. */
  clasificados: number;
  /** Última vez que se leyó este grupo de la fuente. */
  actualizadoEl: Date | null;
  sourceUrl: string | null;
  /**
   * Normativa de la temporada. Es DATOS de la federación, no cálculo nuestro,
   * así que se puede aplicar al ranking oficial: es la que dice cuántas plazas
   * salen por ranking y dónde está el corte de convocatoria.
   */
  rule: RankingTableView['rule'];
};

export type RankingOficialScreenData = {
  seasonLabel: string | null;
  groups: (RankingGroupKey & { tiradores: number })[];
  /** Tabla por grupo, indexada por `groupKey`. */
  tables: Record<string, TablaOficial>;
  /** `grupo` -> `athleteId` -> a cuántos puestos está del corte. */
  cutoffs: Record<string, Record<string, CutoffStatus>>;
  total: number;
  /** Filas sin ficha en esta aplicación. Cada alta por `/alta` baja el número. */
  sinFicha: number;
};

/**
 * Todo el ranking oficial en una pasada.
 *
 * Se carga entero y se manda al cliente, igual que el calendario y por el mismo
 * motivo: en un pabellón con mala cobertura, cambiar de arma no puede ser un
 * viaje a la red. El volumen lo permite —1.235 filas de seis campos cortos, el
 * grupo más grande son 259— y crece con la federación, no con el tiempo.
 */
export async function getRankingOficialScreenData(): Promise<RankingOficialScreenData> {
  const [temporada, filas] = await Promise.all([
    getRankingSeason(),
    db
      .select({
        id: officialRankingEntryTable.id,
        seasonLabel: officialRankingEntryTable.seasonLabel,
        weapon: officialRankingEntryTable.weapon,
        gender: officialRankingEntryTable.gender,
        category: officialRankingEntryTable.category,
        position: officialRankingEntryTable.position,
        totalPoints: officialRankingEntryTable.totalPoints,
        nombre: officialRankingEntryTable.sourceAthleteName,
        club: officialRankingEntryTable.sourceClub,
        nacimiento: officialRankingEntryTable.sourceBirthDate,
        athleteId: officialRankingEntryTable.athleteId,
        sourceUrl: officialRankingEntryTable.sourceUrl,
        updatedAt: officialRankingEntryTable.updatedAt,
      })
      .from(officialRankingEntryTable)
      .orderBy(
        asc(officialRankingEntryTable.weapon),
        asc(officialRankingEntryTable.category),
        asc(officialRankingEntryTable.gender),
        sql`${officialRankingEntryTable.position} asc nulls last`,
        asc(officialRankingEntryTable.sourceAthleteName),
      ),
  ]);

  const vacio: RankingOficialScreenData = {
    seasonLabel: null,
    groups: [],
    tables: {},
    cutoffs: {},
    total: 0,
    sinFicha: 0,
  };

  if (filas.length === 0) return vacio;

  /**
   * Solo la temporada más reciente que trae la fuente. Guardar varias es
   * deliberado (el histórico no se tira), pero mezclar dos en la misma tabla
   * pondría a la misma persona dos veces con puestos distintos.
   */
  const temporadaVigente = [...new Set(filas.map((f) => f.seasonLabel))]
    .sort()
    .at(-1);
  if (!temporadaVigente) return vacio;

  const delAno = filas.filter((f) => f.seasonLabel === temporadaVigente);

  const { rules } = temporada
    ? await loadRankingRules(temporada.id)
    : { rules: [] };

  const tables: Record<string, TablaOficial> = {};
  const groups: (RankingGroupKey & { tiradores: number })[] = [];
  const cutoffs: Record<string, Record<string, CutoffStatus>> = {};

  for (const fila of delAno) {
    const group: RankingGroupKey = {
      weapon: fila.weapon as Weapon,
      gender: fila.gender as Gender,
      category: fila.category as RankingCategory,
    };
    const key = groupKey(group);

    let tabla = tables[key];
    if (!tabla) {
      const rule = pickRule(rules, group.weapon, group.category);
      tabla = {
        group,
        seasonLabel: temporadaVigente,
        rows: [],
        clasificados: 0,
        actualizadoEl: null,
        sourceUrl: fila.sourceUrl,
        rule: rule
          ? {
              countingEvents: rule.countingEvents,
              rankingPlaces: rule.rankingPlaces,
              technicalPlaces: rule.technicalPlaces,
              cutoffDate: rule.cutoffDate,
              sourceDocument: rule.sourceDocument,
              sourceUrl: rule.sourceUrl,
            }
          : null,
      };
      tables[key] = tabla;
      groups.push({ ...group, tiradores: 0 });
    }

    tabla.rows.push({
      id: fila.id,
      position: fila.position,
      nombre: titular(fila.nombre),
      club: fila.club,
      totalPoints: fila.totalPoints === null ? null : Number.parseFloat(fila.totalPoints),
      anioNacimiento: fila.nacimiento ? yearFromIsoDate(fila.nacimiento) : null,
      athleteId: fila.athleteId,
    });
    if (fila.position !== null) tabla.clasificados += 1;
    if (!tabla.actualizadoEl || fila.updatedAt > tabla.actualizadoEl) {
      tabla.actualizadoEl = fila.updatedAt;
    }
  }

  for (const grupo of groups) {
    const key = groupKey(grupo);
    grupo.tiradores = tables[key].rows.length;
  }

  /**
   * Distancia al corte, calculada sobre los puestos OFICIALES.
   *
   * Es la corrección que faltaba: el corte de convocatoria lo decide la
   * clasificación de la federación, no la nuestra, así que medirlo sobre el
   * cálculo interno —que hoy tiene tres filas— daba una respuesta bonita y
   * falsa. La normativa (cuántas plazas y en qué fecha) sigue siendo la misma.
   *
   * Se indexa por `athleteId` porque es lo que la pantalla sabe de quien mira,
   * y solo entran los clasificados: sin puesto no hay distancia que medir.
   */
  for (const [key, tabla] of Object.entries(tables)) {
    if (!tabla.rule) continue;
    const clasificados = tabla.rows
      .filter((r) => r.position !== null)
      .map((r) => ({
        athleteId: r.athleteId ?? r.id,
        position: r.position as number,
        totalPoints: r.totalPoints ?? 0,
      }));

    cutoffs[key] = {};
    for (const fila of tabla.rows) {
      if (!fila.athleteId || fila.position === null) continue;
      const corte = cutoffStatus(clasificados, fila.athleteId, {
        rankingPlaces: tabla.rule.rankingPlaces,
        technicalPlaces: tabla.rule.technicalPlaces,
        cutoffDate: tabla.rule.cutoffDate,
      });
      if (corte) cutoffs[key][fila.athleteId] = corte;
    }
  }

  return {
    seasonLabel: temporadaVigente,
    groups,
    tables,
    cutoffs,
    total: delAno.length,
    sinFicha: delAno.filter((f) => f.athleteId === null).length,
  };
}

/**
 * Cuánta gente hay en el ranking oficial y cuánta tiene ficha aquí.
 *
 * Es una consulta de dos números y se usa para poder hacer una oferta concreta
 * en vez de vaga: «búscate entre los 808 tiradores de la clasificación oficial»
 * convence, «vincula tu ficha» no dice de dónde saldría el dato.
 */
export const contarRankingOficial = cache(
  async (): Promise<{ filas: number; tiradores: number; sinFicha: number }> => {
    const [fila] = await db
      .select({
        filas: sql<number>`count(*)::int`,
        tiradores: sql<number>`count(distinct ${officialRankingEntryTable.skermoAthleteId})::int`,
        sinFicha: sql<number>`count(*) filter (where ${officialRankingEntryTable.athleteId} is null)::int`,
      })
      .from(officialRankingEntryTable);

    return {
      filas: fila?.filas ?? 0,
      tiradores: fila?.tiradores ?? 0,
      sinFicha: fila?.sinFicha ?? 0,
    };
  },
);

/** Puesto y puntos oficiales de un tirador, en un ranking concreto. */
export type PuestoOficial = {
  athleteId: string;
  seasonLabel: string;
  weapon: Weapon;
  gender: Gender;
  category: string;
  /** Literal de la fuente: «VET50» se normaliza a VET y aquí queda el original. */
  categoryRaw: string;
  /** `null` si aparece en la clasificación pero todavía sin puesto. */
  position: number | null;
  totalPoints: number | null;
  club: string | null;
  /**
   * Cuántos tiradores CLASIFICADOS hay en esa clasificación: un 3.º de 50 no es
   * un 3.º de 3.
   *
   * Se cuentan solo los que tienen puesto, no todos los que aparecen. Es la
   * diferencia entre «3.º de 50» y «3.º de 88», y la primera es la cierta: los
   * 38 restantes salen en la lista de la federación con cero puntos y sin
   * puesto, así que no hay nadie por detrás al que ganar en ellos. Y tiene que
   * ser el mismo número aquí y en la tabla del ranking, que es donde se vio
   * primero que no cuadraba.
   */
  deCuantos: number;
  actualizadoEl: Date;
  sourceUrl: string | null;
};

/**
 * Las clasificaciones oficiales de unos tiradores.
 *
 * Es lo que contesta «¿voy bien?» de verdad, y lo que faltaba en «Mi estado»:
 * un 3.º de España con 1.387,77 puntos estaba en la base y la pantalla decía
 * «sin puesto en el ranking» porque solo miraba el cálculo interno.
 *
 * Devuelve TODAS las suyas: un tirador puede estar en absoluto y en sub-23, o
 * en dos armas, y quedarse con una sola es esconderle media temporada.
 */
export async function getPuestosOficiales(
  athleteIds: string[],
): Promise<PuestoOficial[]> {
  if (athleteIds.length === 0) return [];

  const suyas = await db
    .select({
      athleteId: officialRankingEntryTable.athleteId,
      seasonLabel: officialRankingEntryTable.seasonLabel,
      weapon: officialRankingEntryTable.weapon,
      gender: officialRankingEntryTable.gender,
      category: officialRankingEntryTable.category,
      categoryRaw: officialRankingEntryTable.categoryRaw,
      position: officialRankingEntryTable.position,
      totalPoints: officialRankingEntryTable.totalPoints,
      club: officialRankingEntryTable.sourceClub,
      updatedAt: officialRankingEntryTable.updatedAt,
      sourceUrl: officialRankingEntryTable.sourceUrl,
    })
    .from(officialRankingEntryTable)
    .where(inArray(officialRankingEntryTable.athleteId, athleteIds));

  if (suyas.length === 0) return [];

  /**
   * Cuánta gente hay en cada clasificación suya. Sin esto, «3.º» no dice nada:
   * la pantalla tiene que poder escribir «3.º de 88».
   */
  const tamanos = await db
    .select({
      seasonLabel: officialRankingEntryTable.seasonLabel,
      weapon: officialRankingEntryTable.weapon,
      gender: officialRankingEntryTable.gender,
      categoryRaw: officialRankingEntryTable.categoryRaw,
      cuantos: sql<number>`count(*) filter (where ${officialRankingEntryTable.position} is not null)::int`,
    })
    .from(officialRankingEntryTable)
    .groupBy(
      officialRankingEntryTable.seasonLabel,
      officialRankingEntryTable.weapon,
      officialRankingEntryTable.gender,
      officialRankingEntryTable.categoryRaw,
    );

  const clave = (r: {
    seasonLabel: string;
    weapon: string;
    gender: string;
    categoryRaw: string;
  }) => `${r.seasonLabel}|${r.weapon}|${r.gender}|${r.categoryRaw}`;

  const cuantos = new Map(tamanos.map((t) => [clave(t), t.cuantos]));

  return suyas
    .filter((r): r is typeof r & { athleteId: string } => r.athleteId !== null)
    .map((r) => ({
      athleteId: r.athleteId,
      seasonLabel: r.seasonLabel,
      weapon: r.weapon as Weapon,
      gender: r.gender as Gender,
      category: r.category,
      categoryRaw: r.categoryRaw,
      position: r.position,
      totalPoints: r.totalPoints === null ? null : Number.parseFloat(r.totalPoints),
      club: r.club,
      deCuantos: cuantos.get(clave(r)) ?? 0,
      actualizadoEl: r.updatedAt,
      sourceUrl: r.sourceUrl,
    }))
    // Mejor puesto primero; los que aún no están clasificados, al final.
    .sort((a, b) => (a.position ?? 9e9) - (b.position ?? 9e9));
}

// ------------------------------------------------------------ Ficha FIE ---

/**
 * Se reexporta para que la interfaz no tenga que importar de `lib/ingest`:
 * pedir la foto a un ancho concreto es cosa de la pantalla, aunque la regla de
 * cómo se pide sea cosa de la fuente. Ver el comentario largo en
 * `fie-tiradores.ts`: la redimensiona la FIE, no nosotros, y eso no es un
 * detalle de eficiencia sino la condición legal de poder usarla.
 */
export { fotoFieAncho };

/**
 * Un puesto en el ranking MUNDIAL. No confundir con `PuestoOficial`, que es el
 * ranking nacional de la RFEE: son dos números distintos y la pantalla tiene
 * que decir cuál es cuál.
 */
export type PuestoMundialFie = {
  season: number;
  weapon: Weapon;
  gender: Gender;
  category: string;
  /** Literal de la FIE: "S", "J", "C", "V". */
  categoryRaw: string;
  /** Tramo de edad, solo en veteranos ("40-49"). */
  ageBand: string | null;
  /** `null` si aparece en la lista pero sin puesto. */
  position: number | null;
  points: number | null;
  /** Nº de pruebas que le puntúan esa temporada. `null` = la FIE no lo dio. */
  eventCount: number | null;
};

/**
 * Lo que la FIE publica de un tirador nuestro.
 *
 * `fotoUrl` apunta SIEMPRE a `static.fie.org`: se pone tal cual en el `src` de
 * la imagen y no se descarga, no se cachea y no se pasa por el optimizador de
 * imágenes (optimizarla sería servir una copia nuestra, y eso es rehospedar).
 * `fichaUrl` es su ficha en fie.org, y hay que enlazarla siempre que se
 * enseñe la foto: es la condición con la que se usa este dato.
 */
export type FichaFie = {
  athleteId: string;
  fieId: number;
  /** Como lo publica la FIE: "LLAVADOR Carlos". Útil para el pie de la foto. */
  nombrePublicado: string;
  /** La original. Pesa casi 1 MB: para el perfil usa `fotoUrlRetrato`. */
  fotoUrl: string | null;
  /** 320 px de ancho, redimensionada por la FIE. Es la del perfil. */
  fotoUrlRetrato: string | null;
  /** 96 px, para cuando la ficha se usa en una lista. */
  fotoUrlMini: string | null;
  fichaUrl: string;
  /** "L" zurdo, "R" diestro, o null si no lo publica. */
  mano: string | null;
  /** El puesto mundial vigente (mejor puesto de la temporada más reciente). */
  actual: PuestoMundialFie | null;
  /** Su mejor puesto mundial de siempre, con el año en que lo hizo. */
  mejorHistorico: PuestoMundialFie | null;
  /** Todas sus clasificaciones mundiales, de la más reciente a la más vieja. */
  clasificaciones: PuestoMundialFie[];
  actualizadoEl: Date;
};

/**
 * Las fichas de la FIE de unos tiradores, ya enlazadas y confirmadas.
 *
 * Dos consultas y se cose en memoria, igual que el resto del fichero: con
 * Neon por HTTP lo caro es el viaje, y un JOIN repetiría la fila del tirador
 * una vez por cada temporada suya (Llavador tiene 19).
 *
 * Solo devuelve enlaces `CONFIRMADO`. Una propuesta sin revisar NO sale por
 * aquí: enseñar la foto de un candidato es exactamente el error que la cola de
 * revisión existe para evitar.
 */
export async function getFichasFie(
  athleteIds: string[],
): Promise<Map<string, FichaFie>> {
  const out = new Map<string, FichaFie>();
  if (athleteIds.length === 0) return out;

  const fichas = await db
    .select({
      athleteId: fieFencerTable.athleteId,
      fieId: fieFencerTable.fieId,
      sourceName: fieFencerTable.sourceName,
      photoUrl: fieFencerTable.photoUrl,
      profileUrl: fieFencerTable.profileUrl,
      hand: fieFencerTable.hand,
      updatedAt: fieFencerTable.updatedAt,
    })
    .from(fieFencerTable)
    .where(
      and(
        inArray(fieFencerTable.athleteId, athleteIds),
        eq(fieFencerTable.linkStatus, 'CONFIRMADO'),
      ),
    );

  if (fichas.length === 0) return out;

  const clasificaciones = await db
    .select({
      fieId: fieWorldRankingTable.fieId,
      season: fieWorldRankingTable.season,
      weapon: fieWorldRankingTable.weapon,
      gender: fieWorldRankingTable.gender,
      category: fieWorldRankingTable.category,
      categoryRaw: fieWorldRankingTable.categoryRaw,
      ageBand: fieWorldRankingTable.ageBand,
      position: fieWorldRankingTable.position,
      points: fieWorldRankingTable.points,
      eventCount: fieWorldRankingTable.eventCount,
    })
    .from(fieWorldRankingTable)
    .where(
      inArray(
        fieWorldRankingTable.fieId,
        fichas.map((f) => f.fieId),
      ),
    );

  const porFieId = new Map<number, PuestoMundialFie[]>();
  for (const c of clasificaciones) {
    const lista = porFieId.get(c.fieId) ?? [];
    lista.push({
      season: c.season,
      weapon: c.weapon as Weapon,
      gender: c.gender as Gender,
      category: c.category,
      categoryRaw: c.categoryRaw,
      ageBand: c.ageBand,
      position: c.position,
      points: c.points === null ? null : Number.parseFloat(c.points),
      eventCount: c.eventCount,
    });
    porFieId.set(c.fieId, lista);
  }

  for (const ficha of fichas) {
    if (!ficha.athleteId) continue;
    const suyas = (porFieId.get(ficha.fieId) ?? []).sort(
      (a, b) => b.season - a.season || (a.position ?? 9e9) - (b.position ?? 9e9),
    );

    const temporadaMasNueva = suyas[0]?.season ?? null;
    const actual =
      temporadaMasNueva === null
        ? null
        : (suyas.find(
            (c) => c.season === temporadaMasNueva && c.position !== null,
          ) ?? null);

    /**
     * El mejor puesto de siempre. Se ignoran las temporadas sin puesto: un
     * `null` no es un buen puesto, es la ausencia de uno, y colarlo aquí
     * pondría "mejor puesto: —" a quien fue 11.º del mundo.
     */
    const conPuesto = suyas.filter(
      (c): c is PuestoMundialFie & { position: number } => c.position !== null,
    );
    const mejorHistorico =
      conPuesto.length === 0
        ? null
        : conPuesto.reduce((mejor, c) =>
            c.position < mejor.position ? c : mejor,
          );

    out.set(ficha.athleteId, {
      athleteId: ficha.athleteId,
      fieId: ficha.fieId,
      nombrePublicado: ficha.sourceName,
      fotoUrl: ficha.photoUrl,
      fotoUrlRetrato: fotoFieAncho(ficha.photoUrl, 320),
      fotoUrlMini: fotoFieAncho(ficha.photoUrl, 96),
      fichaUrl: ficha.profileUrl,
      mano: ficha.hand,
      actual,
      mejorHistorico,
      clasificaciones: suyas,
      actualizadoEl: ficha.updatedAt,
    });
  }

  return out;
}

/** Lo mínimo para pintar una foto pequeña al lado de un nombre. */
export type AvatarFie = {
  athleteId: string;
  fieId: number;
  /** 96 px, redimensionada por la FIE. **Esta es la que hay que pintar.** */
  fotoUrl: string;
  /** La original, por si hace falta un `srcset` de 2x. Pesa casi 1 MB. */
  fotoUrlOriginal: string;
  fichaUrl: string;
};

/**
 * Solo la foto y el enlace, para las listas.
 *
 * Existe aparte de `getFichasFie` porque la lista de inscritos y la de
 * «Tiradores» pintan decenas de filas y no necesitan las 19 temporadas de
 * nadie: esto es UNA consulta que devuelve tres campos, y las filas sin foto
 * no salen (así la interfaz no tiene que distinguir "sin foto" de "sin
 * ficha": si no está en el mapa, se pinta la inicial de siempre).
 */
export async function getAvataresFie(
  athleteIds: string[],
): Promise<Map<string, AvatarFie>> {
  const out = new Map<string, AvatarFie>();
  if (athleteIds.length === 0) return out;

  const filas = await db
    .select({
      athleteId: fieFencerTable.athleteId,
      fieId: fieFencerTable.fieId,
      photoUrl: fieFencerTable.photoUrl,
      profileUrl: fieFencerTable.profileUrl,
    })
    .from(fieFencerTable)
    .where(
      and(
        inArray(fieFencerTable.athleteId, athleteIds),
        eq(fieFencerTable.linkStatus, 'CONFIRMADO'),
        sql`${fieFencerTable.photoUrl} is not null`,
      ),
    );

  for (const f of filas) {
    if (!f.athleteId || !f.photoUrl) continue;
    out.set(f.athleteId, {
      athleteId: f.athleteId,
      fieId: f.fieId,
      fotoUrl: fotoFieAncho(f.photoUrl, 96) ?? f.photoUrl,
      fotoUrlOriginal: f.photoUrl,
      fichaUrl: f.profileUrl,
    });
  }

  return out;
}

/** Una propuesta de ficha FIE esperando que la mire una persona. */
export type PropuestaFie = {
  fieId: number;
  /** Como lo publica la FIE: "LLAVADOR Carlos". */
  nombrePublicado: string;
  fotoUrl: string | null;
  fichaUrl: string;
  fechaNacimientoFie: string | null;
  licenciaFie: string | null;
  /** La frase de evidencia, para poder decidir sin salir de la pantalla. */
  evidencia: string | null;
  /** El tirador nuestro que propone la ingestión. */
  candidatoAthleteId: string | null;
  candidatoNombre: string | null;
  candidatoFechaNacimiento: string | null;
};

/**
 * La cola de fichas FIE por emparejar.
 *
 * Es la misma idea que `listUnmatchedResults`, y por el mismo motivo: aquí no
 * se empareja por nombre. La FIE no comparte ningún identificador con la
 * RFEE —su número de licencia es la fecha de nacimiento en DDMMAAAA más tres
 * dígitos, no la licencia española—, así que la única vía automática es que
 * alguien haya rellenado `athlete.fie_license`. Todo lo demás llega aquí con
 * la evidencia escrita y lo decide una persona.
 */
export async function listPropuestasFie(limit = 100): Promise<PropuestaFie[]> {
  const filas = await db
    .select({
      fieId: fieFencerTable.fieId,
      sourceName: fieFencerTable.sourceName,
      photoUrl: fieFencerTable.photoUrl,
      profileUrl: fieFencerTable.profileUrl,
      sourceBirthDate: fieFencerTable.sourceBirthDate,
      fieLicense: fieFencerTable.fieLicense,
      matchEvidence: fieFencerTable.matchEvidence,
      candidatoAthleteId: fieFencerTable.proposedAthleteId,
      candidatoNombre: sql<
        string | null
      >`nullif(concat_ws(' ', ${athleteTable.firstName}, ${athleteTable.lastName}), '')`,
      candidatoFechaNacimiento: athleteTable.birthDate,
    })
    .from(fieFencerTable)
    .leftJoin(athleteTable, eq(athleteTable.id, fieFencerTable.proposedAthleteId))
    .where(
      and(
        eq(fieFencerTable.linkStatus, 'PROPUESTO'),
        sql`${fieFencerTable.proposedAthleteId} is not null`,
      ),
    )
    .orderBy(asc(fieFencerTable.sourceName))
    .limit(limit);

  return filas.map((f) => ({
    fieId: f.fieId,
    nombrePublicado: f.sourceName,
    fotoUrl: f.photoUrl,
    fichaUrl: f.profileUrl,
    fechaNacimientoFie: isoDate(f.sourceBirthDate),
    licenciaFie: f.fieLicense,
    evidencia: f.matchEvidence,
    candidatoAthleteId: f.candidatoAthleteId,
    candidatoNombre: f.candidatoNombre,
    candidatoFechaNacimiento: isoDate(f.candidatoFechaNacimiento),
  }));
}

/**
 * Dos números para el panel de admin: cuántos tiradores tienen ficha FIE y
 * cuántas propuestas están esperando. Igual que `contarRankingOficial`, sirve
 * para poder decir algo concreto en vez de vago.
 */
export const contarFichasFie = cache(
  async (): Promise<{
    confirmadas: number;
    propuestas: number;
    rechazadas: number;
    conFoto: number;
  }> => {
    const [fila] = await db
      .select({
        confirmadas: sql<number>`count(*) filter (where ${fieFencerTable.linkStatus} = 'CONFIRMADO')::int`,
        propuestas: sql<number>`count(*) filter (where ${fieFencerTable.linkStatus} = 'PROPUESTO')::int`,
        rechazadas: sql<number>`count(*) filter (where ${fieFencerTable.linkStatus} = 'RECHAZADO')::int`,
        conFoto: sql<number>`count(*) filter (where ${fieFencerTable.linkStatus} = 'CONFIRMADO' and ${fieFencerTable.photoUrl} is not null)::int`,
      })
      .from(fieFencerTable);

    return {
      confirmadas: fila?.confirmadas ?? 0,
      propuestas: fila?.propuestas ?? 0,
      rechazadas: fila?.rechazadas ?? 0,
      conFoto: fila?.conFoto ?? 0,
    };
  },
);

function isoDate(value: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
