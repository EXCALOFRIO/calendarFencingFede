export const LIMITES_INCREMENTO = Object.freeze({
  maxMs: 45_000, maxTasks: 2, maxRequests: 8, requestMs: 6_000, minRequestGapMs: 350,
  maxFacts: 1_000, maxUnits: 100, maxWriteStatements: 1_000,
  maxSeed: 100, maxPdfBytes: 2 * 1024 * 1024, maxPdfPages: 40,
});
export type Kind = 'fie_index' | 'rfee_index' | 'fie_result' | 'rfee_result' | 'rfee_pdf' |
  'fie_standing' | 'rfee_standing' | 'cooldown';
export type Task = {
  key: string; season: string; kind: Kind; payload: Record<string, unknown>;
};
export type Outcome = { status: string; facts: number; payload?: Record<string, unknown>; nextMs?: number };
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** UTC seasons explicitly roll on September 1, never inferred from an event's calendar year. */
export function temporadasActuales(now: Date) {
  const end = now.getUTCFullYear() + (now.getUTCMonth() >= 8 ? 1 : 0);
  return { fie: String(end), rfee: `${end - 1}-${end}` };
}

/**
 * Mutable complete/empty checkpoints are NOT terminal. Results are checked
 * daily for 14 days after their date, then weekly during this season. Standings
 * are observed every 24h. These are minimum intervals, not an SLA: the oldest
 * due units rotate through the two-task queue without starvation.
 */
export function intervaloRevision(task: Task, outcome: Outcome, now: Date): number {
  if (outcome.nextMs !== undefined) return outcome.nextMs;
  if (['error', 'parcial', 'conflicto', 'pendiente'].includes(outcome.status)) return DAY;
  if (task.kind.endsWith('_index') || task.kind.endsWith('_standing')) return DAY;
  const date = typeof task.payload.date === 'string' ? Date.parse(task.payload.date) : NaN;
  if (!Number.isFinite(date)) return 7 * DAY;
  return now.getTime() - date < 14 * DAY ? DAY : 7 * DAY;
}
export function esFutura(task: Task, now: Date) {
  return typeof task.payload.date === 'string' && task.payload.date.slice(0, 10) > now.toISOString().slice(0, 10);
}
export class IncrementoDetenido extends Error {
  constructor(public readonly reason: 'tiempo' | 'peticiones' | 'escrituras' | 'capacidad' | 'limite_remoto' | 'fuente',
    public readonly retryAfterMs: number | null = null) { super(reason); }
}
/** A source-size/parse limit defers only this unit, not the DB safety gates. */
export class UnidadIncrementalDiferida extends Error {
  constructor() { super('sport_unit_limit'); }
}

/** One shared wall-clock/request budget, also checked before every DB mutation. */
export class PresupuestoIncremento {
  readonly start: number;
  requests = 0;
  writeStatements = 0;
  private lastRequest: number | null = null;
  private requestGate: Promise<unknown> = Promise.resolve();
  remote: IncrementoDetenido | null = null;
  constructor(private readonly clock: () => number = Date.now) { this.start = clock(); }
  comprobar = () => {
    if (this.remote) throw this.remote;
    if (this.clock() - this.start >= LIMITES_INCREMENTO.maxMs) throw new IncrementoDetenido('tiempo');
  };
  reservar() {
    this.comprobar();
    if (this.requests >= LIMITES_INCREMENTO.maxRequests) {
      // Source readers catch exceptions. Latch the stop so their "error" result
      // cannot be persisted as a real source check after a budget cut.
      this.remote = new IncrementoDetenido('peticiones');
      throw this.remote;
    }
    this.requests++;
    return Math.max(1, Math.min(LIMITES_INCREMENTO.requestMs,
      LIMITES_INCREMENTO.maxMs - (this.clock() - this.start)));
  }
  /** Atomic batch reservation includes context open/close; never split to fit. */
  reservarEscrituras = (statements: number) => {
    this.comprobar();
    if (!Number.isSafeInteger(statements) || statements < 1 ||
      this.writeStatements + statements > LIMITES_INCREMENTO.maxWriteStatements) {
      this.remote = new IncrementoDetenido('escrituras');
      throw this.remote;
    }
    this.writeStatements += statements;
  };
  /** Shared across separately-created source adapters; concurrent reservations are serialized. */
  reservarPausado(): Promise<number> {
    const reserve = this.requestGate.then(async () => {
      this.comprobar();
      const wait = this.lastRequest === null ? 0 :
        Math.max(0, LIMITES_INCREMENTO.minRequestGapMs - (this.clock() - this.lastRequest));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      const timeout = this.reservar();
      this.lastRequest = this.clock();
      return timeout;
    });
    this.requestGate = reserve.catch(() => {});
    return reserve;
  }
}
