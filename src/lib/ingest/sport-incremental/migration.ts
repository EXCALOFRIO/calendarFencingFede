import type { FilaLedger, MigracionLocal } from '@/lib/db/migracion-aditiva';

export const MIGRACION_INCREMENTO = '0021_incremento_deportivo';
export function preflightIncremento(locales: MigracionLocal[], ledger: FilaLedger[], exists: boolean) {
  const target = locales.at(-1);
  if (!target || target.tag !== MIGRACION_INCREMENTO ||
    locales.at(-2)?.tag !== '0020_guardia_crons' || exists) return false;
  const previous = locales.slice(0, -1);
  const sorted = [...ledger].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  return previous.length === sorted.length && new Set(locales.map((m) => m.tag)).size === locales.length &&
    locales.every((m, i) => Number.isSafeInteger(m.when) && (i === 0 || m.when > locales[i - 1].when)) &&
    previous.every((m, i) => sorted[i].hash === m.hash && Number(sorted[i].created_at) === m.when);
}
