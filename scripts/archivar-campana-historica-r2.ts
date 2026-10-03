import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepararParticionesArchivoLocal } from '../src/lib/ingest/archivo-local';
import { archivarParticionesVerificadas } from '../src/lib/ingest/archivo-campana-r2';
import { createPrivateExportDirectory, sanitizedError } from '../src/lib/migracion-cloudflare/files';
import type { CuboR2 } from '../src/lib/storage';

const BUCKET = 'calendario-esgrima-archivos';
async function main() {
  const { values } = parseArgs({ options: {
    cache: { type: 'string' }, fuente: { type: 'string' }, aplicar: { type: 'boolean' },
    'account-id': { type: 'string' }, 'confirmar-cubo': { type: 'string' },
    concurrencia: { type: 'string', default: '4' }, 'max-segundos': { type: 'string', default: '1800' },
  } });
  if (!values.cache || !['fie', 'rfee'].includes(values.fuente ?? '')) throw new Error('archive_campaign_arguments');
  const concurrency = Number(values.concurrencia), maxMs = Number(values['max-segundos']) * 1000;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 ||
    !Number.isInteger(maxMs) || maxMs < 1 || maxMs > 1_800_000) throw new Error('archive_campaign_arguments');
  const start = Date.now(), plan = await prepararParticionesArchivoLocal(values.cache, values.fuente as 'fie' | 'rfee',
    { comprobar: () => { if (Date.now() - start >= maxMs) throw new Error('archive_time_budget'); } });
  console.log(JSON.stringify({ modo: 'preflight', fuente: plan.fuente, blobs: plan.blobs.length,
    particiones: plan.particiones.length, bytes: plan.bytes, manifiestoOrigenSha256: plan.originalSha256 }));
  if (!values.aplicar) return;
  if (!/^[a-f0-9]{32}$/.test(values['account-id'] ?? '') || values['confirmar-cubo'] !== BUCKET) {
    throw new Error('archive_destination_confirmation_required');
  }
  const directory = await createPrivateExportDirectory(process.cwd()), configPath = join(directory, 'wrangler.json');
  await writeFile(configPath, JSON.stringify({
    name: 'calendario-archivo-local', account_id: values['account-id'], compatibility_date: '2026-09-15',
    r2_buckets: [{ binding: 'ARCHIVOS', bucket_name: BUCKET, remote: true }],
  }), { flag: 'wx', mode: 0o600 });
  delete process.env.CLOUDFLARE_API_TOKEN;
  process.env.WRANGLER_LOG_LEVEL = 'error'; process.chdir(directory);
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ ARCHIVOS: CuboR2 }>({ configPath, envFiles: [], persist: false, remoteBindings: true });
  try {
    const remaining = maxMs - (Date.now() - start);
    if (remaining < 1) throw new Error('archive_time_budget');
    const r = await archivarParticionesVerificadas(proxy.env.ARCHIVOS, plan, {
      concurrencia: concurrency, maxMs: remaining, checkpoint: (checkpoint) => console.log(JSON.stringify(checkpoint)),
    });
    await writeFile(join(directory, 'resultado-archivo.json'), JSON.stringify(r), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(r));
  } finally { await proxy.dispose(); }
}
main().catch((error) => { console.error(sanitizedError(error)); process.exitCode = 1; });
