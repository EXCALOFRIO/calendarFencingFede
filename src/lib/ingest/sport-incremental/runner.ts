import { esFutura, intervaloRevision, IncrementoDetenido, LIMITES_INCREMENTO, PresupuestoIncremento,
  temporadasActuales, UnidadIncrementalDiferida, type Outcome, type Task } from './policy';

export type DepsIncremento = {
  claim: () => Promise<{ release: () => Promise<void> } | null>;
  capacity: () => Promise<boolean>;
  seed: (seasons: ReturnType<typeof temporadasActuales>) => Promise<void>;
  due: (seasons: ReturnType<typeof temporadasActuales>, limit: number) => Promise<Task[]>;
  execute: (task: Task, budget: PresupuestoIncremento) => Promise<Outcome>;
  finish: (task: Task, outcome: Outcome, next: Date) => Promise<void>;
  cooldown: (until: Date) => Promise<void>;
  now: () => Date;
};
export type ResumenIncremento = {
  ok: boolean; status: string; tasks: number; requests: number; facts: number;
};

/** No raw exceptions, URLs, names, payloads or credentials in the response/log. */
export async function ejecutarIncremento(
  enabled: boolean, deps: DepsIncremento, budget = new PresupuestoIncremento(),
): Promise<ResumenIncremento> {
  const result: ResumenIncremento = { ok: true, status: 'deshabilitado', tasks: 0, requests: 0, facts: 0 };
  if (!enabled) return result;
  let lease: Awaited<ReturnType<DepsIncremento['claim']>> = null;
  try {
    budget.comprobar();
    lease = await deps.claim();
    if (!lease) return { ...result, status: 'ocupado' };
    if (!(await deps.capacity())) throw new IncrementoDetenido('capacidad');
    budget.comprobar();
    const seasons = temporadasActuales(deps.now());
    await deps.seed(seasons);
    const tasks = await deps.due(seasons, LIMITES_INCREMENTO.maxTasks);
    result.status = 'ok';
    for (const task of tasks.slice(0, LIMITES_INCREMENTO.maxTasks)) {
      budget.comprobar();
      let outcome: Outcome;
      try {
        outcome = esFutura(task, deps.now()) ? { status: 'pendiente', facts: 0 } : await deps.execute(task, budget);
      } catch (error) {
        if (!(error instanceof UnidadIncrementalDiferida)) throw error;
        outcome = { status: 'pendiente', facts: 0 };
      }
      budget.comprobar(); // readers may catch HTTP errors; never persist those as valid empties.
      await deps.finish(task, outcome, new Date(deps.now().getTime() + intervaloRevision(task, outcome, deps.now())));
      result.tasks++;
      result.facts += outcome.facts;
    }
  } catch (error) {
    const stop = error instanceof IncrementoDetenido ? error : null;
    result.ok = !!stop;
    result.status = stop?.reason ?? 'configuracion_o_db';
    if (stop && (stop.reason === 'limite_remoto' || stop.reason === 'fuente') && lease) {
      // Persist the remote cooldown globally. A retry/next cron must not ignore Retry-After.
      try { await deps.cooldown(new Date(deps.now().getTime() + Math.max(60_000, stop.retryAfterMs ?? 3_600_000))); }
      catch { result.ok = false; result.status = 'configuracion_o_db'; }
    }
  } finally {
    result.requests = budget.requests;
    if (lease) {
      try { await lease.release(); }
      catch { result.ok = false; result.status = 'configuracion_o_db'; }
    }
  }
  return result;
}
