/** Explicit private local export only. No dotenv, Neon or Cloudflare connection. */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { composeHistoricalExport } from '../src/lib/migracion-cloudflare/historical-composition';
import { sanitizedError } from '../src/lib/migracion-cloudflare/files';

async function main() {
  const { values } = parseArgs({ options: {
    preparar: { type: 'boolean' }, 'base-manifest': { type: 'string' }, manifest: { type: 'string' },
    'd1-local': { type: 'string' }, 'base-sha256': { type: 'string' },
    'manifest-sha256': { type: 'string' }, 'source-sha256': { type: 'string' },
  } });
  if (!values.preparar) {
    console.log('Uso: componer-historico-d1.ts --preparar --base-manifest <snapshot-base> --manifest <snapshot-final> --d1-local <historico.sqlite> --base-sha256 <hash> --manifest-sha256 <hash> --source-sha256 <hash>. Solo crea un export privado local; exige que no haya deriva en los hechos o sus identidades.');
    return;
  }
  for (const key of ['base-manifest', 'manifest', 'd1-local', 'base-sha256', 'manifest-sha256', 'source-sha256'] as const) {
    if (!values[key]) throw new Error('history_composition_arguments');
  }
  const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const result = await composeHistoricalExport({
    workspace, baselineManifestPath: values['base-manifest']!, latestManifestPath: values.manifest!,
    historyDatabasePath: values['d1-local']!, expectedBaselineSha256: values['base-sha256']!,
    expectedLatestSha256: values['manifest-sha256']!, expectedHistorySha256: values['source-sha256']!,
  });
  console.log(JSON.stringify(result));
}
main().catch((error) => { console.error(sanitizedError(error)); process.exitCode = 1; });
