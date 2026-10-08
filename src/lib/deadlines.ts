import type { CategoryCode } from './categories';
import { parseFechaMadrid } from './callups/fechas';
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

export type CompetitionFormat = 'INDIVIDUAL' | 'EQUIPOS';

/** Fila de `deadline_rule`. Los importes no están en el código a propósito. */
export type DeadlineRuleRow = {
  id: string;
  scope: Scope;
  circuit: string | null;
  category: CategoryCode | null;
  format: CompetitionFormat | null;
  type: DeadlineType;
  label: string;
  daysBefore: number;
  /** 1 = lunes … 7 = domingo (ISO). Null = contar `daysBefore`. */
  weekday: number | null;
  /** 0 = la semana de la competición, 1 = la anterior. */
  weeksBefore: number;
  /** Hora de cierre en hora de Madrid, "HH:MM". */
  timeOfDay: string | null;
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
  return (rule.circuit ? 4 : 0) + (rule.category ? 2 : 0) + (rule.format ? 1 : 0);
}

export type DeadlineTarget = {
  scope: Scope;
  circuit: string | null;
  category: CategoryCode | null;
  format?: CompetitionFormat | null;
};

export function matchRules(
  rules: DeadlineRuleRow[],
  target: DeadlineTarget,
): DeadlineRuleRow[] {
  const candidates = rules.filter(
    (r) =>
      r.scope === target.scope &&
      (r.circuit === null || r.circuit === target.circuit) &&
      (r.category === null || r.category === target.category) &&
      (r.format === null ||
        target.format === undefined ||
        target.format === null ||
        r.format === target.format),
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
  target: DeadlineTarget,
): ComputedDeadline[] {
  return matchRules(rules, target)
    .map((r) => ({
      type: r.type,
      label: r.label,
      deadlineAt: fechaDeRegla(eventStartDate, r),
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
 * Resuelve la fecha de un hito a partir de su regla.
 *
 * Dos formas de anclar, porque las dos federaciones cuentan distinto:
 *
 * - **La FIE cuenta días**: D-28, D-21, D-14, D-7. Eso es `daysBefore`.
 * - **La RFEE ancla al calendario**: «el viernes de la semana anterior a la
 *   competición a las 12:00 h». Eso es `weekday` + `weeksBefore` + `timeOfDay`,
 *   y no se puede expresar con un contador de días: la misma regla cae a 8 días
 *   de un sábado, a 9 de un domingo y a 11 de un martes.
 *
 * «La semana» es la semana ISO (de lunes a domingo) en la que empieza la
 * competición, que es la que tiene en la cabeza quien escribió la circular:
 * para un torneo del sábado 3 de octubre, «el lunes anterior» es el 28 de
 * septiembre —lunes de su propia semana— y «el viernes de la semana anterior»
 * es el 25 —viernes de la semana de antes—.
 */
export function fechaDeRegla(eventStartDate: string, regla: DeadlineRuleRow): Date {
  if (regla.weekday === null) {
    return isoDateMinusDays(eventStartDate, regla.daysBefore);
  }
  return anclaSemanal(
    eventStartDate,
    regla.weekday,
    regla.weeksBefore,
    regla.timeOfDay,
  );
}

/**
 * Día `weekday` (1 = lunes … 7 = domingo) de la semana ISO en la que empieza la
 * competición, retrocediendo `weeksBefore` semanas, a la hora `timeOfDay` de
 * Madrid.
 *
 * Se calcula sobre la fecha civil, no sobre un instante: restar milisegundos
 * falla en las dos madrugadas del año en que cambia la hora, y es justo cuando
 * caen los plazos de finales de marzo y de octubre.
 */
export function anclaSemanal(
  eventStartDate: string,
  weekday: number,
  weeksBefore = 0,
  timeOfDay: string | null = null,
): Date {
  const [y, m, d] = eventStartDate.slice(0, 10).split('-').map(Number);
  // `getUTCDay()` da 0 para domingo; la norma ISO usa 7.
  const inicio = new Date(Date.UTC(y, m - 1, d));
  const diaIso = inicio.getUTCDay() === 0 ? 7 : inicio.getUTCDay();

  const civil = new Date(inicio);
  civil.setUTCDate(civil.getUTCDate() - (diaIso - weekday) - weeksBefore * 7);

  const iso = civil.toISOString().slice(0, 10);
  // Sin hora escrita, un plazo significa el final del día.
  return parseFechaMadrid(`${iso}T${timeOfDay ?? '23:59'}`) ?? civil;
}

/**
 * Une plazos publicados y calculados. Para el mismo tipo, **la FECHA del
 * publicado gana**: el dato de la fuente tiene prioridad sobre la estimación.
 *
 * Pero solo la fecha. El IMPORTE y el cierre duro se heredan del calculado
 * cuando el publicado no los trae, porque cada uno sabe una cosa distinta:
 *
 *   - El calendario oficial sabe **cuándo** cierra. Publica una fecha y nada
 *     más: se comprobó enumerando las etiquetas del DOM de Skermo, no hay
 *     ningún campo de recargo.
 *   - La normativa sabe **cuánto** cuesta pasarse. Vive en un PDF.
 *
 * Sin esta herencia, en cuanto la fuente publicaba el plazo ordinario la
 * aplicación se quedaba sin el importe: el tirador veía la fecha correcta y un
 * guion donde tenía que decir «+5 €». Es decir, el dato bueno de una fuente
 * borraba el dato bueno de la otra.
 */
export function mergeDeadlines(
  published: ComputedDeadline[],
  calculated: ComputedDeadline[],
): ComputedDeadline[] {
  const byType = new Map<DeadlineType, ComputedDeadline>();
  for (const d of calculated) byType.set(d.type, d);

  for (const d of published) {
    const estimado = byType.get(d.type);
    byType.set(d.type, {
      ...d,
      surchargeEur: d.surchargeEur ?? estimado?.surchargeEur ?? null,
      blocking: d.blocking || (estimado?.blocking ?? false),
      /**
       * La procedencia se acumula, porque cada mitad del dato viene de un
       * sitio: la fecha del calendario y el importe de la circular. Se unen
       * con un «+» y no con una frase porque esto es una nota al pie de letra
       * pequeña: con «… · importe según …» se iba a dos líneas en el móvil.
       */
      sourceDocument:
        estimado?.surchargeEur && !d.surchargeEur && estimado.sourceDocument
          ? `${d.sourceDocument ?? 'Calendario oficial'} + ${estimado.sourceDocument}`
          : d.sourceDocument,
      sourceUrl: d.sourceUrl ?? estimado?.sourceUrl ?? null,
    });
  }

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

export type ResumenPlazo = { texto: string; tono: 'ok' | 'aviso' | 'peligro' | 'neutro' };

/**
 * El estado del plazo en dos o tres palabras, para la pastilla de la cabecera
 * de «Inscripción»: «Cierra en 2 días», «Cierra hoy», «Cerrada». Lo que cierra
 * es el tramo vigente, sea el último o uno con recargo detrás. `null` cuando
 * no hay plazo publicado: no se rellena con avisos.
 */
export function resumenPlazo(estado: DeadlineStatus): ResumenPlazo | null {
  if (estado.closed || estado.state === 'cerrado') return { texto: 'Cerrada', tono: 'neutro' };
  if (estado.state === 'sin_datos') return null;
  const tono = estado.state === 'rojo' ? 'peligro' : estado.state === 'ambar' ? 'aviso' : 'ok';
  const dias = estado.daysLeft;
  if (dias === null) return { texto: 'Plazo vencido', tono };
  if (dias <= 0) return { texto: 'Cierra hoy', tono };
  if (dias === 1) return { texto: 'Cierra mañana', tono };
  return { texto: `Cierra en ${dias} días`, tono };
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
