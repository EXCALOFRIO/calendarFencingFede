/** Explicit local, finite offline import. No dotenv, source requests or remote destinations. */
import { parseArgs } from 'node:util';
import { open, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { abrirD1Local, destinoD1Local } from '../src/lib/ingest/sport-incremental/local';
import { createPrivateExportDirectory, sanitizedError } from '../src/lib/migracion-cloudflare/files';
import {
  prepararCampanaReplay, ejecutarCampanaReplay, LIMITES_CAMPANA_REPLAY, type FuenteCampanaReplay,
} from '../src/lib/ingest/backfill/campana-replay-local';

async function main() {
  const target = destinoD1Local(process.argv.slice(2), process.argv.includes('--aplicar'));
  const { values } = parseArgs({ args: target.args, options: {
    fuente: { type: 'string' }, 'cache-fie': { type: 'string' }, 'cache-nacional': { type: 'string' },
    aplicar: { type: 'boolean' }, 'solo-hechos': { type: 'boolean' },
    'max-unidades': { type: 'string', default: '200' }, 'max-segundos': { type: 'string', default: '1800' },
    'max-sentencias': { type: 'string', default: String(LIMITES_CAMPANA_REPLAY.sentencias) },
    offset: { type: 'string', default: '0' },
  } });
  const plan = await prepararCampanaReplay(values.fuente as FuenteCampanaReplay, values['cache-fie'], values['cache-nacional']);
  const directory = values.aplicar ? await createPrivateExportDirectory(process.cwd()) : null;
  const lockPath = join(dirname(target.path), '.historical-import.lock');
  const lock = values.aplicar ? await open(lockPath, 'wx', 0o600) : null;
  try {
    if (lock) await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    if (directory) await writeFile(join(directory, 'plan.json'), JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
    const result = await ejecutarCampanaReplay(plan, {
      aplicar: Boolean(values.aplicar), soloHechos: Boolean(values['solo-hechos']),
      maxUnidades: Number(values['max-unidades']), maxMs: Number(values['max-segundos']) * 1000,
      maxSentencias: Number(values['max-sentencias']), offset: Number(values.offset),
    }, {
      abrir: (write) => abrirD1Local(target.path, write),
      checkpoint: async (indice, r) => {
        if (directory) await writeFile(join(directory, `unidad-${String(indice).padStart(5, '0')}.json`),
          JSON.stringify(r), { flag: 'wx', mode: 0o600 });
        if ((indice + 1) % 25 === 0) console.log(JSON.stringify({
          event: 'checkpoint', indice: indice + 1, puestosLeidos: r.hechosLeidos.puestos,
          asaltosLeidos: r.hechosLeidos.asaltos, detenido: r.detenido,
        }));
      },
    });
    if (directory) await writeFile(join(directory, 'resultado.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ...result, recibosPrivados: directory }));
    if (result.motivoParada === 'replay_detenido') process.exitCode = 2;
  } finally {
    if (lock) { await lock.close(); await rm(lockPath); }
  }
}
main().catch((error) => { console.error(sanitizedError(error)); process.exitCode = 1; });
