import 'dotenv/config';
import { INGEST_SOURCES, isIngestSource, runIngest } from '../src/lib/ingest/runner';

/**
 * Ejecuta la ingestión desde la línea de órdenes:
 *
 *   npm run ingest                 -> todas las fuentes
 *   npm run ingest -- skermo_rfee  -> solo una
 */
const requested = process.argv.slice(2).filter(isIngestSource);
const sources = requested.length > 0 ? requested : [...INGEST_SOURCES];

for (const source of sources) {
  process.stdout.write(`\n== ${source} ==\n`);
  const result = await runIngest(source, { triggeredBy: 'cli' });
  console.log(
    `  estado=${result.status} vistos=${result.itemsSeen} ` +
      `nuevos=${result.itemsCreated} actualizados=${result.itemsUpdated} ` +
      `sin_cambios=${result.itemsUnchanged} cuarentena=${result.itemsQuarantined} ` +
      `avisos=${result.notificationsQueued} ${result.durationMs} ms`,
  );
  if (result.error) console.log(`  error: ${result.error}`);
  if (result.note) console.log(`  nota: ${result.note}`);
}
