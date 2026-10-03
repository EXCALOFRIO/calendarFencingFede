import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createPrivateExportDirectory, assertCapacity, sanitizedError } from '../src/lib/migracion-cloudflare/files';
import { readTargetSchema, readAndValidateManifest } from '../src/lib/migracion-cloudflare/manifest';
import { boundedQuery, importOrVerify, type D1Executor } from '../src/lib/migracion-cloudflare/importer';

/**
 * Ensayo íntegro en SQLite local privado. No importa credenciales, no conecta
 * con Neon/Cloudflare y nunca reutiliza ni sobrescribe una base existente.
 */
async function main() {
  const { values } = parseArgs({ options: { manifest: { type: 'string' }, ayuda: { type: 'boolean' } } });
  if (!values.manifest || values.ayuda) {
    console.log('Uso: npx tsx scripts/verificar-exportacion-local.ts --manifest <ruta-privada/manifest.json>');
    if (!values.ayuda) process.exitCode = 1;
    return;
  }
  const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const { schema } = await readTargetSchema(workspace);
  const { manifest, manifestSha256 } = await readAndValidateManifest(values.manifest);
  await importOrVerify({ workspace, schema, manifestPath: values.manifest });
  const directory = await createPrivateExportDirectory(workspace);
  await assertCapacity(directory, manifest.summary.byteCount * 3);
  const path = join(directory, 'ensayo.sqlite');
  const databaseId = crypto.randomUUID();
  const sqlite = new DatabaseSync(path);
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    sqlite.exec(await readFile(join(workspace, 'drizzle-d1', '0000_aplicacion.sql'), 'utf8'));
    const executor: D1Executor = {
      databaseId,
      async execute(query) {
        boundedQuery(query.sql, query.params);
        const statement = sqlite.prepare(query.sql);
        if (statement.columns().length) return statement.all(...query.params);
        statement.run(...query.params);
        return [];
      },
    };
    const result = await importOrVerify({
      workspace, schema, manifestPath: values.manifest, executor, apply: true,
      expectedDatabaseId: databaseId, expectedManifestSha256: manifestSha256,
    });
    const verification = await importOrVerify({
      workspace, schema, manifestPath: values.manifest, executor, verifyOnly: true,
    });
    const pageCount = Number(sqlite.prepare('PRAGMA page_count').get()!.page_count);
    const pageSize = Number(sqlite.prepare('PRAGMA page_size').get()!.page_size);
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    console.log(JSON.stringify({
      mode: 'private-local-rehearsal', rows: result.rows, tables: result.tables,
      sourceBytes: result.bytes, sqliteBytes: pageCount * pageSize,
      verifiedTwice: verification.mode === 'verified', databasePath: path,
      manifestSha256, remoteAccess: false,
    }));
  } finally {
    sqlite.close();
  }
}
main().catch((error) => { console.error(sanitizedError(error)); process.exitCode = 1; });
