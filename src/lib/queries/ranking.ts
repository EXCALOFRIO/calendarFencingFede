import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import {
  athlete as athleteTable,
  club as clubTable,
  eventCompetition as eventCompetitionTable,
  event as eventTable,
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
