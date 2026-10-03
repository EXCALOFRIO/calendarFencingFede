import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { readTargetSchema } from '../src/lib/migracion-cloudflare/manifest';
import { importOrVerify } from '../src/lib/migracion-cloudflare/importer';
import { remoteD1 } from '../src/lib/migracion-cloudflare/remote';
import { createPrivateExportDirectory, sanitizedError } from '../src/lib/migracion-cloudflare/files';
import { bindingD1 } from '../src/lib/migracion-cloudflare/binding';
import type { D1Binding } from '../src/db/d1/binding';

async function main() {
  const { values } = parseArgs({ options: {
    manifest: { type: 'string' }, 'database-id': { type: 'string' },
    'confirmar-database-id': { type: 'string' }, 'manifest-sha256': { type: 'string' },
    'account-id': { type: 'string' }, aplicar: { type: 'boolean' },
    verificar: { type: 'boolean' }, ayuda: { type: 'boolean' },
    'wrangler-oauth': { type: 'boolean' },
  } });
  if (!values.manifest || values.ayuda) {
    console.log('Uso: npx tsx scripts/importar-d1.ts --manifest <temp/manifest.json> [--account-id <id> --database-id <uuid>] [--wrangler-oauth] [--verificar | --aplicar --confirmar-database-id <mismo-uuid> --manifest-sha256 <sha256>]\nPor defecto solo preflight; sin destino no hace red. Token: CLOUDFLARE_API_TOKEN o Wrangler OAuth ya autorizado.');
    if (!values.ayuda) process.exitCode = 1;
    return;
  }
  if (values.aplicar && values.verificar) throw new Error('import_modes_conflict');
  if (Boolean(values['database-id']) !== Boolean(values['account-id'])) throw new Error('destination_identifiers_incomplete');
  if (values.aplicar && (!values['database-id'] || values['confirmar-database-id'] !== values['database-id'] || !/^[a-f0-9]{64}$/.test(values['manifest-sha256'] ?? ''))) {
    throw new Error('apply_confirmation_required');
  }
  const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const manifestPath = resolve(values.manifest);
  config({ path: resolve(workspace, '.env'), quiet: true });
  const { schema } = await readTargetSchema(workspace);
  // La validación íntegra de archivos debe preceder incluso a abrir el proxy.
  await importOrVerify({ manifestPath, workspace, schema });
  let dispose: (() => Promise<void>) | undefined;
  let executor;
  if (values['wrangler-oauth']) {
    if (!values['database-id'] || !/^[a-f0-9-]{36}$/i.test(values['database-id']) ||
      !/^[a-f0-9]{32}$/i.test(values['account-id'] ?? '')) throw new Error('destination_identifiers_incomplete');
    const directory = await createPrivateExportDirectory(workspace);
    const configPath = join(directory, 'wrangler.json');
    await writeFile(configPath, JSON.stringify({
      name: 'calendario-migracion-local',
      account_id: values['account-id'],
      compatibility_date: '2026-09-15',
      d1_databases: [{
        binding: 'DB', database_name: 'calendario-fie-fede-db',
        database_id: values['database-id'], remote: true,
      }],
    }), { flag: 'wx', mode: 0o600 });
    // Sólo este proceso usa OAuth. No lee ni exporta el token y no cambia .env.
    delete process.env.CLOUDFLARE_API_TOKEN;
    process.env.WRANGLER_LOG_LEVEL = 'error';
    process.chdir(directory);
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy<{ DB: D1Binding }>({
      configPath, envFiles: [], persist: false, remoteBindings: true,
    });
    dispose = proxy.dispose;
    executor = bindingD1(values['database-id'], proxy.env.DB, values.aplicar);
  } else if (values['database-id']) {
    executor = remoteD1(values['account-id']!, values['database-id'], process.env.CLOUDFLARE_API_TOKEN ?? '', values.aplicar);
  }
  try {
    console.log(JSON.stringify(await importOrVerify({
      manifestPath, workspace, schema, executor, apply: values.aplicar,
      verifyOnly: values.verificar, expectedDatabaseId: values['confirmar-database-id'],
      expectedManifestSha256: values['manifest-sha256'],
    })));
  } finally {
    await dispose?.();
  }
}
main().catch((error) => { console.error(sanitizedError(error)); process.exitCode = 1; });
