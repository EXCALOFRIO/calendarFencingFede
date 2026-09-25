import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  athlete as athleteTable,
  eventCompetition as eventCompetitionTable,
  event as eventTable,
  rankingPoint as rankingPointTable,
  rankingRule as rankingRuleTable,
  rankingSnapshot as rankingSnapshotTable,
  result as resultTable,
  season as seasonTable,
} from '@/db/schema';
import { CIRCUIT_LABEL, formatDateEs } from '../utils';

/**
 * CÁLCULO DEL RANKING INTERNO
 *
 * Dos reglas gobiernan este fichero, y las dos están puestas a propósito:
 *
 * 1. NINGÚN NÚMERO DE LA NORMATIVA SE ESCRIBE AQUÍ. Cuántas pruebas cuentan,
 *    qué coeficiente lleva cada circuito, cuántos puntos da cada puesto,
 *    cuántas plazas salen por ranking y cuántas por criterio técnico, y en qué
 *    fecha se hace el corte: todo sale de la tabla `ranking_rule`. Si la RFEE
 *    cambia el baremo en octubre, el admin edita una fila y la app muestra lo
 *    correcto al segundo siguiente. Si estuviera en el código, habría que
 *    tocar, desplegar y esperar.
 *
 * 2. TODO CÁLCULO SE EXPLICA. Cada fila de `ranking_point` guarda sus puntos
 *    base, su coeficiente, sus puntos finales y una frase legible que dice de
 *    dónde salen y si cuenta o no, y por qué. Un ranking que no se puede
 *    auditar genera más discusiones con los padres que la hoja de cálculo que
 *    venía a sustituir: si alguien pregunta "¿por qué tengo 84 y no 96?", la
 *    respuesta tiene que estar en pantalla, no en la cabeza de alguien.
 *
 * Y una tercera, que es la de toda la app: lo que no está configurado no se
 * inventa. Si un circuito no tiene coeficiente en la tabla, esa prueba NO
 * puntúa y se dice por qué; no se le pone un 1,0 por defecto.
 */

export type Weapon = 'FLORETE' | 'ESPADA' | 'SABLE';
export type Gender = 'M' | 'F' | 'MIXTO';

/** Las diez categorías del enum de base de datos, no las seis de la escalera. */
export const RANKING_CATEGORIES = [
  'M9',
  'M11',
  'M13',
  'M14',
  'M15',
  'M17',
  'M20',
  'M23',
  'ABS',
  'VET',
] as const;
export type RankingCategory = (typeof RANKING_CATEGORIES)[number];

// ------------------------------------------------- Normativa configurable ---

/**
 * Tabla puesto -> puntos base.
 *
 * Se admiten dos formas de clave porque las dos aparecen en los baremos
 * reales: el puesto exacto (`"1": 32`) y el tramo (`"9-16": 8`), que es como
 * la RFEE reparte de octavos para abajo. Escribir 8 filas iguales a mano
 * invita a erratas.
 */
export const pointsTableSchema = z.record(
  z.string().regex(/^\d+(-\d+)?$/, 'Las claves son "12" o "9-16"'),
  z.coerce.number().nonnegative(),
);

/** Coeficiente por circuito. La clave `"*"` vale como "todos los demás". */
export const coefficientsSchema = z.record(
  z.string().min(1),
  z.coerce.number().nonnegative(),
);

export type RankingRuleRow = {
  id: string;
  seasonId: string;
  weapon: Weapon | null;
  category: RankingCategory | null;
  countingEvents: number;
  coefficients: Record<string, number>;
  pointsTable: Record<string, number>;
  rankingPlaces: number;
  technicalPlaces: number;
  cutoffDate: Date | null;
  sourceDocument: string | null;
  sourceUrl: string | null;
};

/** Una regla que no se pudo leer. No se ignora en silencio: se cuenta y se dice. */
export type InvalidRankingRule = {
  id: string;
  weapon: string | null;
  category: string | null;
  errors: { path: string; message: string }[];
};

/**
 * Carga la normativa de ranking de una temporada.
 *
 * Los JSON de `coefficients` y `points_table` los escribe una persona en el
 * panel de admin, así que se validan igual que lo que llega de un scraper: si
 * una regla trae un JSON roto, esa regla no se aplica y sale en el informe,
 * en vez de reventar el cálculo entero o, peor, aplicar medio baremo.
 */
export async function loadRankingRules(seasonId: string): Promise<{
  rules: RankingRuleRow[];
  invalid: InvalidRankingRule[];
}> {
  const rows = await db
    .select()
    .from(rankingRuleTable)
    .where(and(eq(rankingRuleTable.seasonId, seasonId), eq(rankingRuleTable.active, true)));

  const rules: RankingRuleRow[] = [];
  const invalid: InvalidRankingRule[] = [];

  for (const row of rows) {
    const coefficients = coefficientsSchema.safeParse(row.coefficients);
    const pointsTable = pointsTableSchema.safeParse(row.pointsTable);

    if (!coefficients.success || !pointsTable.success) {
      invalid.push({
        id: row.id,
        weapon: row.weapon,
        category: row.category,
        errors: [
          ...(coefficients.success
            ? []
            : coefficients.error.issues.map((i) => ({
                path: `coefficients.${i.path.join('.')}`,
                message: i.message,
              }))),
          ...(pointsTable.success
            ? []
            : pointsTable.error.issues.map((i) => ({
                path: `pointsTable.${i.path.join('.')}`,
                message: i.message,
              }))),
        ],
      });
      continue;
    }

    rules.push({
      id: row.id,
      seasonId: row.seasonId,
      weapon: row.weapon as Weapon | null,
      category: row.category as RankingCategory | null,
      countingEvents: row.countingEvents,
      coefficients: coefficients.data,
      pointsTable: pointsTable.data,
      rankingPlaces: row.rankingPlaces,
      technicalPlaces: row.technicalPlaces,
      cutoffDate: row.cutoffDate,
      sourceDocument: row.sourceDocument,
      sourceUrl: row.sourceUrl,
    });
  }

  return { rules, invalid };
}

/**
 * Regla aplicable a un arma y una categoría: gana la más específica.
 *
 * (arma + categoría) > (arma) > (categoría) > (general). Así el admin puede
 * poner una regla general y luego una excepción para M17 sin duplicar nada.
 */
export function pickRule(
  rules: RankingRuleRow[],
  weapon: Weapon,
  category: RankingCategory,
): RankingRuleRow | null {
  let best: RankingRuleRow | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (rule.weapon !== null && rule.weapon !== weapon) continue;
    if (rule.category !== null && rule.category !== category) continue;
    const score = (rule.weapon !== null ? 2 : 0) + (rule.category !== null ? 1 : 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Puntos base de un puesto según la tabla de la normativa.
 *
 * Devuelve `null` —no cero— cuando la tabla no llega a ese puesto: son cosas
 * distintas y la explicación las cuenta distinto. "La tabla no llega al puesto
 * 96" es un dato de la normativa; "has sacado cero puntos" es un juicio.
 */
export function basePointsForPosition(
  pointsTable: Record<string, number>,
  position: number,
): number | null {
  const exact = pointsTable[String(position)];
  if (exact !== undefined) return exact;

  for (const [key, value] of Object.entries(pointsTable)) {
    const range = key.match(/^(\d+)-(\d+)$/);
    if (!range) continue;
    const from = Number.parseInt(range[1], 10);
    const to = Number.parseInt(range[2], 10);
    if (position >= from && position <= to) return value;
  }

  return null;
}

/** Coeficiente del circuito, o null si la normativa no lo contempla. */
export function coefficientForCircuit(
  coefficients: Record<string, number>,
  circuit: string,
): number | null {
  const exact = coefficients[circuit];
  if (exact !== undefined) return exact;
  const fallback = coefficients['*'];
  return fallback !== undefined ? fallback : null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Formato español de un número, para meterlo dentro de la explicación. */
function num(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

// ------------------------------------------------------------- Cálculo ---

export type RankingContribution = {
  athleteId: string;
  eventCompetitionId: string;
  resultId: string | null;
  eventName: string;
  eventCity: string | null;
  eventDate: string;
  circuit: string;
  position: number;
  basePoints: number;
  coefficient: number;
  finalPoints: number;
  counted: boolean;
  explanation: string;
};

export type RankingGroupResult = {
  weapon: Weapon;
  gender: Gender;
  category: RankingCategory;
  rule: RankingRuleRow;
  rows: {
    athleteId: string;
    athleteName: string;
    clubId: string | null;
    position: number;
    totalPoints: number;
    countedEventIds: string[];
    contributions: RankingContribution[];
  }[];
};

export type ComputeOutcome = {
  ok: boolean;
  seasonId: string | null;
  seasonLabel: string | null;
  groups: RankingGroupResult[];
  /** Puntos escritos en `ranking_point`. */
  pointsWritten: number;
  /** Filas escritas en `ranking_snapshot`. */
  snapshotsWritten: number;
  invalidRules: InvalidRankingRule[];
  /**
   * Resultados que existen pero no han entrado en ningún ranking, y por qué.
   * Es lo primero que hay que mirar cuando alguien dice "me falta una prueba".
   */
  skipped: { reason: string; count: number }[];
  /** Explicación en una frase de por qué no hay ranking, si no lo hay. */
  reason: string | null;
};

type SkipCounter = Map<string, number>;

function addSkip(counter: SkipCounter, reason: string) {
  counter.set(reason, (counter.get(reason) ?? 0) + 1);
}

/**
 * Recalcula el ranking de una temporada completa y lo guarda.
 *
 * El cálculo es puro hasta el último paso: primero se construye todo en
 * memoria (`groups`), y solo al final se escribe. Así el mismo código sirve
 * para "calcular y guardar" y para "enséñame qué saldría" sin tocar nada.
 */
export async function computeSeasonRanking(
  options: { seasonId?: string; persist?: boolean } = {},
): Promise<ComputeOutcome> {
  const persist = options.persist ?? true;

  const [season] = options.seasonId
    ? await db.select().from(seasonTable).where(eq(seasonTable.id, options.seasonId)).limit(1)
    : await db.select().from(seasonTable).where(eq(seasonTable.current, true)).limit(1);

  const empty: ComputeOutcome = {
    ok: false,
    seasonId: season?.id ?? null,
    seasonLabel: season?.label ?? null,
    groups: [],
    pointsWritten: 0,
    snapshotsWritten: 0,
    invalidRules: [],
    skipped: [],
    reason: null,
  };

  if (!season) {
    return {
      ...empty,
      reason:
        'No hay ninguna temporada marcada como actual. Sin temporada no hay ' +
        'normativa que aplicar ni periodo que mirar.',
    };
  }

  const { rules, invalid } = await loadRankingRules(season.id);
  empty.invalidRules = invalid;

  if (rules.length === 0) {
    return {
      ...empty,
      reason:
        `La temporada ${season.label} no tiene ninguna regla de ranking ` +
        'configurada. Hay que rellenar `ranking_rule` con cuántas pruebas ' +
        'cuentan, los coeficientes por circuito y la tabla de puntos por ' +
        'puesto, tomándolos de la circular de la RFEE.',
    };
  }

  // --- Resultados emparejados de la temporada ---
  const resultRows = await db
    .select({
      resultId: resultTable.id,
      athleteId: resultTable.athleteId,
      eventCompetitionId: resultTable.eventCompetitionId,
      position: resultTable.position,
      weapon: eventCompetitionTable.weapon,
      gender: eventCompetitionTable.gender,
      category: eventCompetitionTable.category,
      format: eventCompetitionTable.format,
      competitionDate: eventCompetitionTable.competitionDate,
      eventName: eventTable.name,
      eventCity: eventTable.city,
      eventStartDate: eventTable.startDate,
      circuit: eventTable.circuit,
      firstName: athleteTable.firstName,
      lastName: athleteTable.lastName,
      clubId: athleteTable.clubId,
    })
    .from(resultTable)
    .innerJoin(
      eventCompetitionTable,
      eq(eventCompetitionTable.id, resultTable.eventCompetitionId),
    )
    .innerJoin(eventTable, eq(eventTable.id, eventCompetitionTable.eventId))
    .innerJoin(athleteTable, eq(athleteTable.id, resultTable.athleteId))
    .where(
      and(
        isNotNull(resultTable.athleteId),
        isNotNull(resultTable.eventCompetitionId),
        sql`${eventTable.startDate} >= ${season.startDate}`,
        sql`${eventTable.startDate} <= ${season.endDate}`,
      ),
    );

  const skips: SkipCounter = new Map();

  if (resultRows.length === 0) {
    return {
      ...empty,
      reason:
        `No hay ningún resultado emparejado con un tirador en la temporada ` +
        `${season.label}. Hasta que no se carguen resultados y se emparejen ` +
        'por número de licencia, no hay nada que ordenar.',
    };
  }

  /** arma|género|categoría -> tirador -> sus pruebas */
  const groups = new Map<string, Map<string, RankingContribution[]>>();
  const athleteInfo = new Map<string, { name: string; clubId: string | null }>();

  for (const row of resultRows) {
    if (!row.athleteId || !row.eventCompetitionId) continue;

    // El ranking individual se calcula sobre pruebas individuales. Los equipos
    // puntúan para el club, que es otra clasificación distinta.
    if (row.format !== 'INDIVIDUAL') {
      addSkip(skips, 'Prueba por equipos: no entra en el ranking individual');
      continue;
    }

    const weapon = row.weapon as Weapon;
    const gender = row.gender as Gender;
    const category = row.category as RankingCategory;
    const rule = pickRule(rules, weapon, category);

    if (!rule) {
      addSkip(
        skips,
        `Sin regla de ranking para ${weapon} ${category}: la normativa de la ` +
          'temporada no cubre esa combinación',
      );
      continue;
    }

    const eventDate = isoDate(row.competitionDate) ?? isoDate(row.eventStartDate);
    if (!eventDate) {
      addSkip(skips, 'La prueba no tiene fecha y no se puede situar en el corte');
      continue;
    }

    /**
     * Fecha de corte: solo cuenta lo celebrado hasta ella. Es lo que permite
     * decir "el ranking con el que se hace la convocatoria es este", y no uno
     * que cambia cada fin de semana mientras se decide.
     */
    if (rule.cutoffDate && eventDate > isoFromDate(rule.cutoffDate)) {
      addSkip(
        skips,
        `Celebrada después de la fecha de corte (${formatDateEs(rule.cutoffDate)})`,
      );
      continue;
    }

    const circuitLabel = CIRCUIT_LABEL[row.circuit] ?? row.circuit;
    const basePoints = basePointsForPosition(rule.pointsTable, row.position);
    const coefficient = coefficientForCircuit(rule.coefficients, row.circuit);

    const where = row.eventCity ? `${row.eventName} (${row.eventCity})` : row.eventName;
    const when = formatDateEs(eventDate);

    let finalPoints = 0;
    let explanation: string;

    if (basePoints === null) {
      explanation =
        `Puesto ${row.position} en «${where}», ${when} — ${circuitLabel}. ` +
        'La tabla de puntos de la normativa no llega a ese puesto, así que ' +
        'esta prueba no suma puntos.';
    } else if (coefficient === null) {
      explanation =
        `Puesto ${row.position} en «${where}», ${when} — ${circuitLabel}. ` +
        `Da ${num(basePoints)} puntos base, pero la normativa de la temporada ` +
        `no tiene coeficiente configurado para el circuito «${circuitLabel}», ` +
        'así que esta prueba no suma. No se le aplica ningún valor por defecto.';
    } else {
      finalPoints = round2(basePoints * coefficient);
      explanation =
        `Puesto ${row.position} en «${where}», ${when} — ${circuitLabel}. ` +
        `${num(basePoints)} puntos base × coeficiente ${num(coefficient)} = ` +
        `${num(finalPoints)} puntos.`;
    }

    const key = `${weapon}|${gender}|${category}`;
    const byAthlete = groups.get(key) ?? new Map<string, RankingContribution[]>();
    const list = byAthlete.get(row.athleteId) ?? [];

    list.push({
      athleteId: row.athleteId,
      eventCompetitionId: row.eventCompetitionId,
      resultId: row.resultId,
      eventName: row.eventName,
      eventCity: row.eventCity,
      eventDate,
      circuit: row.circuit,
      position: row.position,
      basePoints: basePoints ?? 0,
      coefficient: coefficient ?? 0,
      finalPoints,
      counted: false,
      explanation,
    });

    byAthlete.set(row.athleteId, list);
    groups.set(key, byAthlete);
    athleteInfo.set(row.athleteId, {
      name: `${row.firstName} ${row.lastName}`.trim(),
      clubId: row.clubId,
    });
  }

  // --- Mejores N y totales ---
  const outcomeGroups: RankingGroupResult[] = [];

  for (const [key, byAthlete] of groups) {
    const [weapon, gender, category] = key.split('|') as [
      Weapon,
      Gender,
      RankingCategory,
    ];
    const rule = pickRule(rules, weapon, category);
    if (!rule) continue;

    const rows = [...byAthlete.entries()].map(([athleteId, contributions]) => {
      // De más a menos puntos; a igualdad, primero la más reciente, que es la
      // que mejor refleja el estado de forma y además es un desempate estable.
      const ordered = [...contributions].sort(
        (a, b) => b.finalPoints - a.finalPoints || b.eventDate.localeCompare(a.eventDate),
      );

      const counted = ordered.slice(0, rule.countingEvents).filter((c) => c.finalPoints > 0);
      const countedIds = new Set(counted.map((c) => c.eventCompetitionId));

      for (const contribution of ordered) {
        const isCounted = countedIds.has(contribution.eventCompetitionId);
        contribution.counted = isCounted;
        contribution.explanation += isCounted
          ? ` Cuenta: está entre tus ${rule.countingEvents} mejores resultados de ` +
            `${weapon.toLowerCase()} ${category} de la temporada.`
          : contribution.finalPoints > 0
            ? ` No cuenta: solo suman las ${rule.countingEvents} mejores y esta ` +
              `queda por debajo (tienes ${ordered.filter((c) => c.finalPoints > 0).length} ` +
              'pruebas puntuables).'
            : '';
      }

      const totalPoints = round2(counted.reduce((sum, c) => sum + c.finalPoints, 0));

      return {
        athleteId,
        athleteName: athleteInfo.get(athleteId)?.name ?? 'Tirador sin nombre',
        clubId: athleteInfo.get(athleteId)?.clubId ?? null,
        position: 0,
        totalPoints,
        countedEventIds: counted.map((c) => c.eventCompetitionId),
        contributions: ordered,
      };
    });

    /**
     * Orden y empates. Se usa el orden de competición clásico (1, 2, 2, 4): dos
     * tiradores con los mismos puntos comparten puesto, porque decir que uno va
     * por delante del otro sin criterio sería inventárselo. Los desempates que
     * sí existen —más pruebas puntuables, mejor resultado individual— se aplican
     * antes, y solo si siguen empatados comparten posición.
     */
    rows.sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        b.countedEventIds.length - a.countedEventIds.length ||
        (b.contributions[0]?.finalPoints ?? 0) - (a.contributions[0]?.finalPoints ?? 0) ||
        a.athleteName.localeCompare(b.athleteName, 'es'),
    );

    let position = 0;
    let previousTotal: number | null = null;
    rows.forEach((row, index) => {
      if (previousTotal === null || row.totalPoints !== previousTotal) {
        position = index + 1;
        previousTotal = row.totalPoints;
      }
      row.position = position;
    });

    outcomeGroups.push({ weapon, gender, category, rule, rows });
  }

  const outcome: ComputeOutcome = {
    ok: outcomeGroups.length > 0,
    seasonId: season.id,
    seasonLabel: season.label,
    groups: outcomeGroups,
    pointsWritten: 0,
    snapshotsWritten: 0,
    invalidRules: invalid,
    skipped: [...skips.entries()].map(([reason, count]) => ({ reason, count })),
    reason:
      outcomeGroups.length === 0
        ? 'Hay resultados y hay normativa, pero ninguno encaja con el otro. ' +
          'Mira los motivos del apartado "descartados".'
        : null,
  };

  if (!persist || outcomeGroups.length === 0) return outcome;

  const written = await persistRanking(season.id, outcomeGroups);
  outcome.pointsWritten = written.points;
  outcome.snapshotsWritten = written.snapshots;

  return outcome;
}

/**
 * Escribe el resultado del cálculo.
 *
 * `ranking_point` se reemplaza entero para la temporada: si una prueba deja de
 * puntuar (la anulan, cambia la normativa), su fila tiene que desaparecer, y
 * un upsert sin borrado dejaría puntos fantasma sumando para siempre.
 *
 * `ranking_snapshot` es una serie temporal —para eso existe: para poder decir
 * "cuánto te movió esta competición"—, así que se añade. Lo único que se
 * borra es el snapshot del mismo día, para que recalcular tres veces una tarde
 * no llene la tabla de copias idénticas.
 */
async function persistRanking(
  seasonId: string,
  groups: RankingGroupResult[],
): Promise<{ points: number; snapshots: number }> {
  const now = new Date();

  const pointRows: (typeof rankingPointTable.$inferInsert)[] = [];
  const snapshotRows: (typeof rankingSnapshotTable.$inferInsert)[] = [];

  for (const group of groups) {
    for (const row of group.rows) {
      for (const contribution of row.contributions) {
        pointRows.push({
          seasonId,
          athleteId: row.athleteId,
          eventCompetitionId: contribution.eventCompetitionId,
          resultId: contribution.resultId,
          position: contribution.position,
          basePoints: contribution.basePoints.toFixed(2),
          coefficient: contribution.coefficient.toFixed(3),
          finalPoints: contribution.finalPoints.toFixed(2),
          counted: contribution.counted ? '1' : '0',
          explanation: contribution.explanation,
          computedAt: now,
        });
      }

      snapshotRows.push({
        seasonId,
        weapon: group.weapon,
        gender: group.gender,
        category: group.category,
        athleteId: row.athleteId,
        position: row.position,
        totalPoints: row.totalPoints.toFixed(2),
        countedEventIds: row.countedEventIds,
        computedAt: now,
      });
    }
  }

  // Puntos: fuera los de la temporada y dentro los recién calculados.
  await db.delete(rankingPointTable).where(eq(rankingPointTable.seasonId, seasonId));
  for (const batch of chunk(pointRows, 200)) {
    await db.insert(rankingPointTable).values(batch);
  }

  // Snapshots: solo se pisa el de hoy.
  await db
    .delete(rankingSnapshotTable)
    .where(
      and(
        eq(rankingSnapshotTable.seasonId, seasonId),
        sql`${rankingSnapshotTable.computedAt}::date = ${now.toISOString().slice(0, 10)}::date`,
      ),
    );
  for (const batch of chunk(snapshotRows, 200)) {
    await db.insert(rankingSnapshotTable).values(batch);
  }

  return { points: pointRows.length, snapshots: snapshotRows.length };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isoDate(value: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return isoFromDate(value);
}

/** Fecha en día natural español: por UTC media temporada se iría un día atrás. */
function isoFromDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

// -------------------------------------------- A cuántos puestos del corte ---

export type CutoffStatus = {
  position: number;
  totalPoints: number;
  /** Plazas que salen por ranking, según la normativa de la temporada. */
  rankingPlaces: number;
  /** Plazas que decide el criterio técnico, que NO dependen del ranking. */
  technicalPlaces: number;
  /** ¿Está dentro de las plazas de ranking? */
  inside: boolean;
  /** Cuántos puestos le faltan para entrar. 0 si ya está dentro. */
  placesAway: number;
  /** Cuántos puntos le faltan para alcanzar al último dentro del corte. */
  pointsAway: number | null;
  cutoffDate: Date | null;
  /** ¿Ya pasó la fecha de corte? Si sí, el ranking ya no se mueve. */
  cutoffPassed: boolean;
  explanation: string;
};

/**
 * "¿A cuántos puestos estoy del corte de convocatoria?"
 *
 * Es la pregunta que hoy se responde por teléfono y la razón de que exista
 * esta pantalla. La respuesta lleva siempre las dos mitades: los puestos que
 * faltan Y los puntos, porque tres puestos pueden ser dos puntos o doscientos.
 *
 * Y lleva el aviso de las plazas técnicas, que es la letra pequeña que más
 * malentendidos genera: si de seis plazas dos son técnicas, ir undécimo en el
 * ranking no significa estar a cinco puestos de ir convocado.
 */
export function cutoffStatus(
  rows: { athleteId: string; position: number; totalPoints: number }[],
  athleteId: string,
  rule: Pick<RankingRuleRow, 'rankingPlaces' | 'technicalPlaces' | 'cutoffDate'>,
  now: Date = new Date(),
): CutoffStatus | null {
  const me = rows.find((r) => r.athleteId === athleteId);
  if (!me) return null;

  const { rankingPlaces, technicalPlaces, cutoffDate } = rule;
  const cutoffPassed = cutoffDate !== null && now.getTime() > cutoffDate.getTime();
  const inside = rankingPlaces > 0 && me.position <= rankingPlaces;
  const placesAway = inside ? 0 : Math.max(0, me.position - rankingPlaces);

  /**
   * El "último dentro" es quien ocupa la última plaza de ranking. Si hay
   * empate en esa posición, se coge al que menos puntos tiene de los
   * empatados: es el listón real que hay que superar.
   */
  const lastInside = [...rows]
    .filter((r) => r.position <= rankingPlaces)
    .sort((a, b) => a.totalPoints - b.totalPoints)[0];

  const pointsAway =
    inside || !lastInside ? null : round2(Math.max(0, lastInside.totalPoints - me.totalPoints));

  if (rankingPlaces === 0) {
    return {
      position: me.position,
      totalPoints: me.totalPoints,
      rankingPlaces,
      technicalPlaces,
      inside: false,
      placesAway: 0,
      pointsAway: null,
      cutoffDate,
      cutoffPassed,
      explanation:
        `Vas ${me.position}.º con ${num(me.totalPoints)} puntos. La normativa de ` +
        'la temporada no tiene configuradas plazas por ranking para esta ' +
        'categoría, así que no se puede decir dónde está el corte.',
    };
  }

  const partes: string[] = [];
  partes.push(`Vas ${me.position}.º con ${num(me.totalPoints)} puntos.`);

  if (inside) {
    partes.push(
      `Estás dentro de las ${rankingPlaces} plazas que salen por ranking.`,
    );
  } else {
    partes.push(
      `El corte está en el puesto ${rankingPlaces}: ` +
        `${placesAway === 1 ? 'te falta 1 puesto' : `te faltan ${placesAway} puestos`}` +
        (pointsAway !== null ? ` y ${num(pointsAway)} puntos.` : '.'),
    );
  }

  if (technicalPlaces > 0) {
    partes.push(
      technicalPlaces === 1
        ? 'Además hay 1 plaza de criterio técnico, que no depende del ranking.'
        : `Además hay ${technicalPlaces} plazas de criterio técnico, que no ` +
          'dependen del ranking.',
    );
  }

  if (cutoffDate) {
    partes.push(
      cutoffPassed
        ? `La fecha de corte (${formatDateEs(cutoffDate)}) ya pasó: este ranking ya no se mueve.`
        : `El corte se hace el ${formatDateEs(cutoffDate)}.`,
    );
  } else {
    partes.push('La normativa no fija fecha de corte para esta categoría.');
  }

  return {
    position: me.position,
    totalPoints: me.totalPoints,
    rankingPlaces,
    technicalPlaces,
    inside,
    placesAway,
    pointsAway,
    cutoffDate,
    cutoffPassed,
    explanation: partes.join(' '),
  };
}

/**
 * Recalcula solo lo que toca tras cargar resultados nuevos. Hoy delega en el
 * cálculo completo: con 20 tiradores y unos cientos de resultados eso son
 * milisegundos, y un cálculo parcial sería complejidad sin beneficio. Existe
 * como punto único al que llamar desde el cron o desde el panel de admin.
 */
export async function recomputeAfterIngest(seasonId?: string): Promise<ComputeOutcome> {
  return computeSeasonRanking({ seasonId, persist: true });
}

/** Tiradores a los que afectaría el recálculo. Útil para avisos dirigidos. */
export async function athletesWithResults(seasonId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ athleteId: rankingPointTable.athleteId })
    .from(rankingPointTable)
    .where(eq(rankingPointTable.seasonId, seasonId));
  return rows.map((r) => r.athleteId);
}

/** Comprobación puntual: ¿estos tiradores tienen ficha activa? */
export async function activeAthletes(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: athleteTable.id })
    .from(athleteTable)
    .where(and(inArray(athleteTable.id, ids), eq(athleteTable.active, true)));
  return new Set(rows.map((r) => r.id));
}
