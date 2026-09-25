import type { CategoryCode } from './categories';
import { isoDateMinusDays } from './utils';

export type DeadlineType = 'L1' | 'L2' | 'L3' | 'FIE_D7';
export type DeadlineOrigin = 'PUBLICADO' | 'CALCULADO';
export type Scope = 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO';

export const DEADLINE_TYPE_LABEL: Record<DeadlineType, string> = {
  L1: 'Límite ordinario',
  L2: 'Segundo plazo',
  L3: 'Tercer plazo',
  FIE_D7: 'Cierre FIE (D-7)',
};

/** Fila de `deadline_rule`. Los importes no están en el código a propósito. */
export type DeadlineRuleRow = {
  id: string;
  scope: Scope;
  circuit: string | null;
  category: CategoryCode | null;
  type: DeadlineType;
  label: string;
  daysBefore: number;
  surchargeEur: string | null;
  blocking: boolean;
  sourceDocument: string | null;
  sourceUrl: string | null;
};

export type ComputedDeadline = {
  type: DeadlineType;
  label: string;
  deadlineAt: Date;
  surchargeEur: string | null;
  blocking: boolean;
  origin: DeadlineOrigin;
  sourceDocument: string | null;
  sourceUrl: string | null;
  ruleId?: string;
};

/**
 * Cuál de las reglas que encajan es la que manda. Se prefiere siempre la más
 * específica: una regla escrita para `SEN_WC` gana a la genérica de
 * INTERNACIONAL, y una escrita para M17 gana a la que no distingue categoría.
 */
function specificity(rule: DeadlineRuleRow): number {
  return (rule.circuit ? 2 : 0) + (rule.category ? 1 : 0);
}

export function matchRules(
  rules: DeadlineRuleRow[],
  target: { scope: Scope; circuit: string | null; category: CategoryCode | null },
): DeadlineRuleRow[] {
  const candidates = rules.filter(
    (r) =>
      r.scope === target.scope &&
      (r.circuit === null || r.circuit === target.circuit) &&
      (r.category === null || r.category === target.category),
  );

  const bestByType = new Map<DeadlineType, DeadlineRuleRow>();
  for (const r of candidates) {
    const current = bestByType.get(r.type);
    if (!current || specificity(r) > specificity(current)) bestByType.set(r.type, r);
  }
  return [...bestByType.values()];
}

/**
 * Calcula las fechas límite de un evento a partir de las reglas y de su fecha
 * de inicio. Todo lo que sale de aquí es `origin: 'CALCULADO'`, es decir
 * ESTIMADO: en la interfaz se marca como tal y nunca se presenta igual que un
 * plazo publicado por la fuente.
 */
export function computeDeadlines(
  eventStartDate: string,
  rules: DeadlineRuleRow[],
  target: { scope: Scope; circuit: string | null; category: CategoryCode | null },
): ComputedDeadline[] {
  return matchRules(rules, target)
    .map((r) => ({
      type: r.type,
      label: r.label,
      deadlineAt: isoDateMinusDays(eventStartDate, r.daysBefore),
      surchargeEur: r.surchargeEur,
      blocking: r.blocking,
      origin: 'CALCULADO' as const,
      sourceDocument: r.sourceDocument,
      sourceUrl: r.sourceUrl,
      ruleId: r.id,
    }))
    .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
}

/**
 * Une plazos publicados y calculados. El publicado SIEMPRE gana sobre el
 * calculado para el mismo tipo: el dato de la fuente tiene prioridad sobre la
 * estimación.
 */
export function mergeDeadlines(
  published: ComputedDeadline[],
  calculated: ComputedDeadline[],
): ComputedDeadline[] {
  const byType = new Map<DeadlineType, ComputedDeadline>();
  for (const d of calculated) byType.set(d.type, d);
  for (const d of published) byType.set(d.type, d);
  return [...byType.values()].sort(
    (a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime(),
  );
}

export type DeadlineState = 'verde' | 'ambar' | 'rojo' | 'cerrado' | 'sin_datos';

export type DeadlineStatus = {
  state: DeadlineState;
  /** Texto listo para pintar. El estado nunca se comunica solo por color. */
  label: string;
  /** Próximo hito por vencer, si queda alguno. */
  next: ComputedDeadline | null;
  daysLeft: number | null;
  /** Recargo que se paga AHORA mismo (el del último hito ya pasado). */
  currentSurchargeEur: string | null;
  /** Recargo en el que se entra cuando venza el próximo hito. */
  nextSurchargeEur: string | null;
  /** True si ya pasó un cierre duro: no se puede inscribir en absoluto. */
  closed: boolean;
  /** True si algún plazo mostrado es una estimación, no un dato publicado. */
  hasEstimates: boolean;
};

/**
 * Semáforo de plazos. Sale de aquí y solo de aquí, para que la fila del
 * calendario, la ficha lateral y el email de aviso digan exactamente lo mismo.
 */
export function deadlineStatus(
  deadlines: ComputedDeadline[],
  now: Date = new Date(),
): DeadlineStatus {
  const hasEstimates = deadlines.some((d) => d.origin === 'CALCULADO');

  if (deadlines.length === 0) {
    return {
      state: 'sin_datos',
      label: 'Plazo no publicado',
      next: null,
      daysLeft: null,
      currentSurchargeEur: null,
      nextSurchargeEur: null,
      closed: false,
      hasEstimates: false,
    };
  }

  const sorted = [...deadlines].sort(
    (a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime(),
  );
  const passed = sorted.filter((d) => d.deadlineAt.getTime() <= now.getTime());
  const upcoming = sorted.filter((d) => d.deadlineAt.getTime() > now.getTime());

  const blockingPassed = passed.find((d) => d.blocking);
  if (blockingPassed) {
    return {
      state: 'cerrado',
      label: `Inscripción cerrada (${blockingPassed.label})`,
      next: null,
      daysLeft: null,
      currentSurchargeEur: null,
      nextSurchargeEur: null,
      closed: true,
      hasEstimates,
    };
  }

  // El recargo vigente es el del último hito que ya venció.
  const currentSurchargeEur =
    [...passed].reverse().find((d) => d.surchargeEur !== null)?.surchargeEur ?? null;

  const next = upcoming[0] ?? null;
  if (!next) {
    /**
     * Han vencido todos los hitos conocidos, pero NINGUNO era un cierre
     * duro: si lo hubiera sido, se habría salido por la rama de arriba.
     *
     * Eso no significa que la inscripción esté cerrada, significa que **no
     * sabemos** cuándo cierra: la fuente no publica un cierre y las reglas
     * de la normativa no llegan hasta aquí. Marcarlo como cerrado era
     * inventarse un dato, y además tenía consecuencia práctica: dejaba el
     * botón de solicitar inscripción desactivado en torneos a los que
     * todavía se podía ir. Se avisa en rojo y se deja decidir a la persona.
     */
    return {
      state: 'rojo',
      label:
        'El último plazo publicado ya venció. Confirma con la organización ' +
        'antes de contar con ello.',
      next: null,
      daysLeft: null,
      currentSurchargeEur,
      nextSurchargeEur: null,
      closed: false,
      hasEstimates,
    };
  }

  const daysLeft = Math.ceil(
    (next.deadlineAt.getTime() - now.getTime()) / 86_400_000,
  );

  let state: DeadlineState;
  if (daysLeft <= 3 || next.blocking) state = 'rojo';
  else if (daysLeft <= 7 || passed.length > 0) state = 'ambar';
  else state = 'verde';

  const dayWord = daysLeft === 1 ? 'día' : 'días';
  let label = `Quedan ${daysLeft} ${dayWord} para el ${next.label.toLowerCase()}`;
  if (next.blocking) {
    label += '; después ya no se puede inscribir';
  } else if (next.surchargeEur && Number.parseFloat(next.surchargeEur) > 0) {
    label += `; después son ${Number.parseFloat(next.surchargeEur)} € más`;
  }

  return {
    state,
    label,
    next,
    daysLeft,
    currentSurchargeEur,
    nextSurchargeEur: next.surchargeEur,
    closed: false,
    hasEstimates,
  };
}

/**
 * Los eventos con cierre inminente son los que hay que refrescar con más
 * cuidado: los últimos 7 días antes de un cierre son los críticos. El cron
 * diario los repasa en un segundo paso (son pocos).
 */
export function isDeadlineImminent(
  deadlines: ComputedDeadline[],
  now: Date = new Date(),
  windowDays = 7,
): boolean {
  return deadlines.some((d) => {
    const diff = d.deadlineAt.getTime() - now.getTime();
    return diff > 0 && diff <= windowDays * 86_400_000;
  });
}

/**
 * Nota de procedencia que se muestra debajo del semáforo. Los recargos viven
 * dentro de circulares en PDF y no se pueden recopilar de ninguna parte
 * automáticamente, así que en vez de "un número que aparece ahí" se enseña de
 * dónde sale, de cuándo es y con enlace al documento.
 */
export function provenanceNote(
  deadlines: ComputedDeadline[],
  updatedAt?: Date | null,
): { text: string; url: string | null } | null {
  const withSource = deadlines.find((d) => d.sourceDocument);
  if (!withSource) return null;
  const when = updatedAt
    ? ` · actualizado el ${new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/Madrid',
      }).format(updatedAt)}`
    : '';
  return {
    text:
      `Recargos según ${withSource.sourceDocument} de la RFEE${when}. ` +
      'Consulta siempre la convocatoria oficial de la prueba.',
    url: withSource.sourceUrl,
  };
}

/**
 * Cómo se enuncia el recargo de un hito.
 *
 * NADA INVENTADO: "Sin recargo" es una afirmación, y la fuente casi nunca la
 * hace. Medido contra la base real: las 382 fechas límite publicadas tienen
 * el recargo a NULL. Pintarlas todas como "Sin recargo" es decirle al
 * usuario que inscribirse tarde le sale gratis sin que nadie lo haya
 * publicado. `null` es "no publicado"; solo un 0 explícito es "sin recargo".
 *
 * Vive aquí y no en un componente porque es una regla del producto: tiene
 * que decir lo mismo en la ficha, en el correo de aviso y en el calendario.
 */
export function etiquetaRecargo(surchargeEur: string | null): {
  texto: string;
  tono: 'warn' | 'muted';
} {
  if (surchargeEur === null || surchargeEur === '') {
    return { texto: 'Recargo no publicado', tono: 'muted' };
  }
  const n = Number.parseFloat(surchargeEur);
  if (!Number.isFinite(n)) return { texto: 'Recargo no publicado', tono: 'muted' };
  if (n > 0) {
    return {
      texto: `+${new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: n % 1 === 0 ? 0 : 2,
      }).format(n)}`,
      tono: 'warn',
    };
  }
  return { texto: 'Sin recargo', tono: 'muted' };
}
