/** Offline whole public inventory coordinator. No DB/app bootstrap or model API. */
import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { preparePortfolio, loadPortfolio, runPortfolio, inspectPortfolioUnit, aggregate } from '../src/lib/ingest/factory-batch/portfolio';
import { readBounded } from '../src/lib/ingest/factory-batch/files';
import { digestSchema } from '../src/lib/ingest/factory-batch/schemas';

const HELP = `Portfolio público completo Factory / gpt-6-sol. Preparación/preflight: CERO llamadas modelo.
--preparar --cache-rfee ABS --cache-fie ABS
  [--manifiesto-rfee-sha256 HASH] [--manifiesto-fie-sha256 HASH]
  [--semillas ABS_JSON] (planes ya completados y validados; no relanzados)
  Semillas JSON: [{"directory":"ABS","planSha256":"HASH"}]
--portfolio ABS --portfolio-sha256 HASH
--portfolio ABS --portfolio-sha256 HASH --ejecutar --droid ABS_EXE
  --max-sesiones-total N (obligatorio, <= inventario elegible)
  [--trabajos-paso 10] [--concurrencia 2] [--timeout-segundos 300]
  [--pared-paso-segundos 900] [--pared-total-segundos 43200]
Máximos: 250 trabajos/plan y paso; concurrencia8; proceso600s; paso3600s; total48h.
Un piloto capability por plan nuevo, contabilizado aparte de sesiones fuente.
Todos los candidatos requieren reconciliar fuente. Fallos no se reintentan.
Missing/invalid hook, drift, errores seguridad/teardown: ABORT GLOBAL.
Nunca descarga, importa, sube, despliega ni modifica cachés/settings globales.`;
function absolute(value: string | undefined): string {
  if (!value || !isAbsolute(value)) throw new Error('factory_absolute_path_required');
  return resolve(value);
}
function integer(value: string | undefined, fallback?: number) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new Error('factory_portfolio_numeric_option_required');
  return Number(value);
}
async function main() {
  const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
    help: { type: 'boolean' }, preparar: { type: 'boolean' }, ejecutar: { type: 'boolean' },
    'cache-rfee': { type: 'string' }, 'cache-fie': { type: 'string' },
    'manifiesto-rfee-sha256': { type: 'string' }, 'manifiesto-fie-sha256': { type: 'string' },
    semillas: { type: 'string' }, portfolio: { type: 'string' }, 'portfolio-sha256': { type: 'string' },
    droid: { type: 'string' }, 'max-sesiones-total': { type: 'string' }, 'trabajos-paso': { type: 'string' },
    concurrencia: { type: 'string' }, 'timeout-segundos': { type: 'string' },
    'pared-paso-segundos': { type: 'string' }, 'pared-total-segundos': { type: 'string' },
  } });
  if (values.help || !Object.keys(values).length) { console.log(HELP); return; }
  if (values.preparar) {
    if (values.ejecutar || values.portfolio) throw new Error('factory_portfolio_prepare_options_invalid');
    const sources = [];
    for (const source of ['rfee', 'fie'] as const) if (values[`cache-${source}`]) {
      sources.push({ source, cacheRoot: absolute(values[`cache-${source}`]),
        manifestSha256: values[`manifiesto-${source}-sha256`] });
    }
    const seeds = values.semillas ? z.array(z.object({ directory: z.string(), planSha256: digestSchema }).strict())
      .max(500).parse(JSON.parse((await readBounded(absolute(values.semillas), 128 * 1024)).toString('utf8'))) : [];
    const prepared = await preparePortfolio({ workspace: resolve(import.meta.dirname, '..'), sources, seeds });
    console.log(JSON.stringify({ status: 'prepared_offline', ...prepared })); return;
  }
  const directory = absolute(values.portfolio), portfolioSha256 = values['portfolio-sha256'] ?? '';
  if (!values.ejecutar) {
    const loaded = await loadPortfolio(directory, portfolioSha256), states = [];
    for (const campaign of loaded.portfolio.campaigns) {
      for (const assignment of campaign.assignments) states.push(await inspectPortfolioUnit(campaign,
        loaded.plans.get(campaign.directory)!, assignment));
    }
    console.log(JSON.stringify({ status: 'preflight_offline', portfolioSha256,
      summary: aggregate(states, loaded.entries), plans: loaded.portfolio.campaigns.length }));
    return;
  }
  const result = await runPortfolio({ directory, portfolioSha256, executable: absolute(values.droid), execute: true,
    maxSessionsTotal: integer(values['max-sesiones-total']), stepJobs: integer(values['trabajos-paso'], 10),
    concurrency: integer(values.concurrencia, 2), timeoutSeconds: integer(values['timeout-segundos'], 300),
    stepWallSeconds: integer(values['pared-paso-segundos'], 900),
    wallSecondsTotal: integer(values['pared-total-segundos'], 43200) });
  console.log(JSON.stringify(result));
}
main().catch(error => {
  const code = error instanceof Error ? error.message : '';
  console.error(/^factory_[a-z0-9_]{1,100}$/.test(code) ? code : 'factory_portfolio_operation_failed');
  process.exitCode = 1;
});
