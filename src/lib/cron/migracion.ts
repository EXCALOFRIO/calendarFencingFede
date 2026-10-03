import type { FilaLedger, MigracionLocal } from '../db/migracion-aditiva';

export const MIGRACION_CRON = '0020_guardia_crons';
export type EstadoMigracionCron = {
  ledger: FilaLedger[];
  tablaCronExiste: boolean;
  tablaIngestExiste: boolean;
};
export type VeredictoMigracionCron =
  | { ok: true; pendiente: MigracionLocal }
  | { ok: false; motivos: string[] };

/** Preflight puro. No repara el ledger ni aplica migraciones previas pendientes. */
export function evaluarPreflightCron(
  locales: MigracionLocal[],
  estado: EstadoMigracionCron,
): VeredictoMigracionCron {
  const motivos: string[] = [];
  const pendiente = locales.at(-1);
  const previas = locales.slice(0, -1);
  if (!pendiente || pendiente.tag !== MIGRACION_CRON) {
    motivos.push('0020_guardia_crons no es la cola del journal');
  }
  if (previas.at(-1)?.tag !== '0019_categorias_m10_m12') {
    motivos.push('falta el ancla previa 0019 del journal');
  }
  const tags = new Set<string>();
  for (let i = 0; i < locales.length; i++) {
    const m = locales[i];
    if (tags.has(m.tag)) motivos.push('journal con etiquetas repetidas');
    tags.add(m.tag);
    if (!Number.isSafeInteger(m.when) || (i > 0 && m.when <= locales[i - 1].when)) {
      motivos.push(`journal no creciente en ${m.tag}`);
    }
  }
  const ledger = [...estado.ledger].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  if (ledger.length !== previas.length) {
    motivos.push(`ledger tiene ${ledger.length} filas y se esperaban ${previas.length}`);
  } else {
    previas.forEach((m, i) => {
      if (ledger[i].hash !== m.hash) motivos.push(`hash del ledger distinto en ${m.tag}`);
      if (Number(ledger[i].created_at) !== m.when) motivos.push(`created_at del ledger distinto en ${m.tag}`);
    });
  }
  if (pendiente && ledger.some((f) => f.hash === pendiente.hash || Number(f.created_at) === pendiente.when)) {
    motivos.push('0020 ya figura en el ledger');
  }
  if (estado.tablaCronExiste) motivos.push('cron_execution ya existe; no se modifica');
  if (!estado.tablaIngestExiste) motivos.push('falta la tabla previa ingest_run');
  return motivos.length || !pendiente ? { ok: false, motivos } : { ok: true, pendiente };
}
