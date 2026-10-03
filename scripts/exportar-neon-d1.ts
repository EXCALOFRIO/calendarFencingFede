import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { readTargetSchema } from '../src/lib/migracion-cloudflare/manifest';
import { createPrivateExportDirectory, sanitizedError } from '../src/lib/migracion-cloudflare/files';
import { exportSnapshot } from '../src/lib/migracion-cloudflare/exporter';

async function main() {
  const { values } = parseArgs({ options: { exportar: { type: 'boolean' }, ayuda: { type: 'boolean' } } });
  if (!values.exportar || values.ayuda) {
    console.log('Uso: npx tsx scripts/exportar-neon-d1.ts --exportar\nFuente: NEON_SOURCE_DATABASE_URL (o DATABASE_URL en .env). Snapshot REPEATABLE READ READ ONLY; salida privada temporal; no credenciales de Neon Auth.');
    return;
  }
  const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
  config({ path: resolve(workspace, '.env'), quiet: true });
  const connectionString = process.env.NEON_SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('source_database_url_required');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) throw new Error('source_neon_url_required');
  const { schema } = await readTargetSchema(workspace);
  const directory = await createPrivateExportDirectory(workspace);
  neonConfig.webSocketConstructor = WebSocket;
  neonConfig.poolQueryViaFetch = false;
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const manifest = await exportSnapshot(client, schema, directory);
      console.log(JSON.stringify({ directory, migrationId: manifest.migrationId, ...manifest.summary }));
    } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch((error) => { console.error(sanitizedError(error)); process.exitCode = 1; });
