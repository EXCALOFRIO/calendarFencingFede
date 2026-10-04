/**
 * Independent local extraction CLI. No application bootstrap, dotenv, database,
 * archive upload, deployment or custom model API imports.
 */
import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { prepareCampaign, loadCampaign } from '../src/lib/ingest/factory-batch/prepare';
import { runCampaign } from '../src/lib/ingest/factory-batch/runner';
import { readBounded } from '../src/lib/ingest/factory-batch/files';
import type { SeleccionArchivoLocal } from '../src/lib/ingest/archivo-local';

const HELP = `Extracción pública acotada con sesiones independientes Factory / gpt-6-sol.
Sin red/modelo por defecto. Nunca importa datos ni modifica cachés/DB/despliegues.

Preparar (offline; crea carpeta privada nueva fuera del repositorio):
  --preparar --fuente rfee|fie --cache RUTA_ABSOLUTA
  --seleccion JSON_ABSOLUTO --manifiesto-sha256 SHA256
Seleccion JSON: [{"tipo":"pdf","id":"pdf-<sha256>"}] o
               [{"tipo":"fie","season":2025,"competitionId":123}]
Máximo 250 unidades; no HTML/OCR; una sesión por PDF o competición FIE.

Preflight offline:
  --plan CARPETA_ABSOLUTA --plan-sha256 SHA256

Piloto obligatorio de contención (una sesión real; autorización explícita):
  --plan CARPETA --plan-sha256 SHA256 --droid EXE_ABSOLUTO
  --piloto-capacidad --ejecutar --max-sesiones 1

Extraer (sesiones reales; solo tras receipt válido del piloto):
  --plan CARPETA --plan-sha256 SHA256 --droid EXE_ABSOLUTO
  --ejecutar --max-sesiones N [--concurrencia 1|2]
  [--timeout-segundos 300] [--pared-segundos 900]
Límites: timeout <=600s, pared <=3600s, salida stdout+stderr <=4MiB/sesión.
Resume solo receipts coincidentes; trabajos iniciados sin receipt requieren
reconciliación manual. Nunca se relanzan automáticamente.
Todos los resultados son candidatos: requires_source_reconciliation.
--help no red ni ejecución.`;

function numberOption(value: string | undefined, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error('factory_max_sessions_required');
  }
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('factory_numeric_option_invalid');
  return Number(value);
}
function absolute(value: string | undefined): string {
  if (!value || !isAbsolute(value)) throw new Error('factory_absolute_path_required');
  return resolve(value);
}
async function main() {
  const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
    help: { type: 'boolean' }, preparar: { type: 'boolean' }, ejecutar: { type: 'boolean' },
    'piloto-capacidad': { type: 'boolean' }, fuente: { type: 'string' }, cache: { type: 'string' },
    seleccion: { type: 'string' }, 'manifiesto-sha256': { type: 'string' },
    plan: { type: 'string' }, 'plan-sha256': { type: 'string' }, droid: { type: 'string' },
    'max-sesiones': { type: 'string' }, concurrencia: { type: 'string' },
    'timeout-segundos': { type: 'string' }, 'pared-segundos': { type: 'string' },
  } });
  if (values.help || !Object.keys(values).length) { console.log(HELP); return; }
  if (values.preparar) {
    if (values.ejecutar || values.plan || values['piloto-capacidad'] ||
      !['rfee', 'fie'].includes(values.fuente ?? '')) throw new Error('factory_prepare_options_invalid');
    let selections: SeleccionArchivoLocal[];
    try { selections = JSON.parse((await readBounded(absolute(values.seleccion), 128 * 1024)).toString('utf8')); }
    catch { throw new Error('factory_selection_json_invalid'); }
    const result = await prepareCampaign({
      workspace: resolve(import.meta.dirname, '..'), cacheRoot: absolute(values.cache),
      source: values.fuente as 'rfee' | 'fie', selections,
      sourceManifestSha256: values['manifiesto-sha256'] ?? '',
    });
    // Operational private-folder location + hashes/counts only; no names/source content.
    console.log(JSON.stringify({ status: 'prepared_offline', ...result }));
    return;
  }
  const directory = absolute(values.plan), planSha256 = values['plan-sha256'] ?? '';
  if (!values.ejecutar) {
    if (values['piloto-capacidad']) throw new Error('factory_explicit_execution_required');
    const plan = await loadCampaign(directory, planSha256);
    console.log(JSON.stringify({ status: 'preflight_offline', jobs: plan.jobs.length, model: plan.model, planSha256 }));
    return;
  }
  const summary = await runCampaign({
    directory, planSha256, executable: absolute(values.droid), execute: true,
    maxSessions: numberOption(values['max-sesiones']), concurrency: numberOption(values.concurrencia, 1),
    timeoutSeconds: numberOption(values['timeout-segundos'], 300),
    wallSeconds: numberOption(values['pared-segundos'], 900), capabilityPilot: !!values['piloto-capacidad'],
  });
  console.log(JSON.stringify({ status: 'candidates_only', ...summary }));
}
main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  console.error(/^[a-z][a-z0-9_]{2,100}$/.test(message) ? message : 'factory_operation_failed');
  process.exitCode = 1;
});
