import { ejecutarIncremento, type ResumenIncremento } from './runner';
import { PresupuestoIncremento } from './policy';

/** OFF by default. No DB initialization, source requests or Neon fallback while off. */
export async function runSportIncremental(): Promise<ResumenIncremento> {
  const disabled: ResumenIncremento = { ok: true, status: 'deshabilitado', tasks: 0, requests: 0, facts: 0 };
  if (process.env.SPORT_INCREMENTAL_ENABLED !== 'true') return disabled;
  try {
    const [{ db }, { crearDepsIncrementoDb }] = await Promise.all([import('@/db'), import('./db')]);
    const budget = new PresupuestoIncremento();
    return await ejecutarIncremento(true, crearDepsIncrementoDb(db, budget), budget);
  } catch {
    return { ...disabled, ok: false, status: 'configuracion_o_db' };
  }
}
