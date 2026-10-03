import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepararArchivoLocal, prepararSeleccionArchivoLocal, leerBlobArchivadoLocal, type SeleccionArchivoLocal,
} from '../src/lib/ingest/archivo-local';
import { guardarArchivoVerificado } from '../src/lib/ingest/archivo-r2';
import { createPrivateExportDirectory, sanitizedError } from '../src/lib/migracion-cloudflare/files';
import type { CuboR2 } from '../src/lib/storage';

const BUCKET = 'calendario-esgrima-archivos';
async function main() {
  const { values } = parseArgs({ options: {
    'cache-fie': { type: 'string' }, 'cache-rfee': { type: 'string' },
    'account-id': { type: 'string' }, 'confirmar-cubo': { type: 'string' },
    aplicar: { type: 'boolean' },
    fie: { type: 'string', multiple: true }, html: { type: 'string', multiple: true },
    pdf: { type: 'string', multiple: true },
  } });
  const fie: SeleccionArchivoLocal[] = (values.fie ?? []).map((value) => {
    const m = /^(\d{4}):([1-9]\d*)$/.exec(value);
    if (!m) throw new Error('archive_selection_invalid');
    return { tipo: 'fie', season: Number(m[1]), competitionId: Number(m[2]) };
  });
  const nacional: SeleccionArchivoLocal[] = [
    ...(values.html ?? []).map((id) => ({ tipo: 'html' as const, id })),
    ...(values.pdf ?? []).map((id) => ({ tipo: 'pdf' as const, id })),
  ];
  if ((fie.length && !values['cache-fie']) || (nacional.length && !values['cache-rfee'])) {
    throw new Error('archive_cache_required');
  }
  const plans = [];
  if (values['cache-fie']) plans.push(fie.length
    ? await prepararSeleccionArchivoLocal(values['cache-fie'], 'fie', fie)
    : await prepararArchivoLocal(values['cache-fie'], 'fie'));
  if (values['cache-rfee']) plans.push(nacional.length
    ? await prepararSeleccionArchivoLocal(values['cache-rfee'], 'rfee', nacional)
    : await prepararArchivoLocal(values['cache-rfee'], 'rfee'));
  if (!plans.length) throw new Error('archive_cache_required');
  const bytes = plans.reduce((sum, plan) => sum + plan.bytes, 0);
  if (bytes > 512 * 1024 * 1024) throw new Error('archive_campaign_limit');
  console.log(JSON.stringify({ mode: 'preflight', fuentes: plans.map((p) => ({
    fuente: p.fuente, blobs: p.blobs.length, bytes: p.bytes, manifestSha256: p.hash,
  })), bytes }));
  if (!values.aplicar) return;
  if (!/^[a-f0-9]{32}$/.test(values['account-id'] ?? '') || values['confirmar-cubo'] !== BUCKET) {
    throw new Error('archive_destination_confirmation_required');
  }
  const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const directory = await createPrivateExportDirectory(workspace);
  const configPath = join(directory, 'wrangler.json');
  await writeFile(configPath, JSON.stringify({
    name: 'calendario-archivo-local', account_id: values['account-id'], compatibility_date: '2026-09-15',
    r2_buckets: [{ binding: 'ARCHIVOS', bucket_name: BUCKET, remote: true }],
  }), { flag: 'wx', mode: 0o600 });
  delete process.env.CLOUDFLARE_API_TOKEN;
  process.env.WRANGLER_LOG_LEVEL = 'error';
  process.chdir(directory);
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ ARCHIVOS: CuboR2 }>({ configPath, envFiles: [], persist: false, remoteBindings: true });
  const deadline = Date.now() + 30 * 60_000;
  let guardados = 0, reutilizados = 0;
  try {
    for (const plan of plans) {
      for (const blob of plan.blobs) {
        if (Date.now() >= deadline) throw new Error('archive_time_budget');
        const outcome = await guardarArchivoVerificado(proxy.env.ARCHIVOS, blob.clave,
          await leerBlobArchivadoLocal(blob), blob.hash, 'application/octet-stream');
        if (outcome === 'guardado') guardados++; else reutilizados++;
        if ((guardados + reutilizados) % 100 === 0) console.log(JSON.stringify({ guardados, reutilizados }));
      }
      if (Date.now() >= deadline) throw new Error('archive_time_budget');
      await guardarArchivoVerificado(proxy.env.ARCHIVOS, plan.clave, plan.manifest, plan.hash, 'application/json');
      // Manifest is published only after every referenced blob was verified.
      await writeFile(join(directory, `archivo-${plan.fuente}.json`), JSON.stringify({
        fuente: plan.fuente, manifestSha256: plan.hash, clave: plan.clave, blobs: plan.blobs.length,
        bytes: plan.bytes, guardados, reutilizados, verifiedAt: new Date().toISOString(),
      }), { flag: 'wx', mode: 0o600 });
    }
    console.log(JSON.stringify({ mode: 'verified', guardados, reutilizados, bytes }));
  } finally { await proxy.dispose(); }
}
main().catch((error) => { console.error(sanitizedError(error)); process.exitCode = 1; });
