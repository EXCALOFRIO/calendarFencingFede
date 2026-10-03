/**
 * Deliberately does not load dotenv: the existing environment guard still
 * refuses DATABASE_URL on --aplicar. No source or remote target is discovered.
 */
import { abrirD1Local, destinoD1Local } from '../src/lib/ingest/sport-incremental/local';
import { ejecutarReplayLocal, parsearArgsReplayLocal, USO_REPLAY_LOCAL } from '../src/lib/ingest/backfill/replay-local';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(USO_REPLAY_LOCAL);
  } else {
    const target = destinoD1Local(args, args.includes('--aplicar'));
    const options = parsearArgsReplayLocal(target.args);
    const result = await ejecutarReplayLocal(options, { abrir: (write) => abrirD1Local(target.path, write) });
    console.log(JSON.stringify(result));
    process.exitCode = result.detenido || Object.keys(result.incidencias).length ? 2 : 0;
  }
} catch {
  // Never print a caught exception, path, URL, private row, manifest or body.
  console.error(JSON.stringify({ detenido: true, incidencia: 'invalid_arguments_or_local_target' }));
  process.exitCode = 2;
}
