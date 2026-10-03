/**
 * Download-only RFEE cache. No dotenv/app DB import, discovery or remote writes.
 * Default mode is offline dry-run; --aplicar executes ONE checkpoint batch.
 * Root state preserves the cumulative 2000 GET / 30 min / 512 MiB campaign.
 *
 * npx tsx scripts/descargar-historico-nacional.ts --inventario <json> --cache <directory>
 * Add --aplicar --max-unidades 200 to download. --replay verifies all cached blobs offline.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateWindowId } from '../src/lib/ingest/backfill/download-window';
import {
  crearFetchReplayNacional,
  ejecutarLoteNacional,
  leerManifiestoCacheNacional,
  prepararUnidadesNacionales,
  resumirCacheNacional,
  type InventarioCacheNacional,
  type TipoDocumentoNacional,
} from '../src/lib/ingest/backfill/cache-nacional';

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set<string>();
  const valores = new Map<string, string>();
  const booleanos = new Set(['--aplicar', '--replay', '--reintentar', '--help']);
  const opciones = new Set(['--inventario', '--cache', '--max-unidades', '--max-peticiones', '--max-minutos', '--temporadas', '--tipos', '--window']);
  for (let n = 0; n < args.length; n++) {
    const arg = args[n];
    if (booleanos.has(arg)) flags.add(arg);
    else if (opciones.has(arg) && args[n + 1] && !args[n + 1].startsWith('--')) {
      valores.set(arg, args[++n]);
    } else throw new Error('Argumento no reconocido o sin valor');
  }
  if (flags.has('--help')) {
    console.log('RFEE local download-only: --inventario <json> --cache <directory> [--aplicar] [--max-unidades 1..200] [--max-peticiones 1..2000] [--max-minutos 0..30] [--temporadas AAAA-AAAA,...] [--tipos html,pdf] [--reintentar] [--replay]');
    return;
  }
  const rootArg = valores.get('--cache');
  if (!rootArg) throw new Error('Falta --cache');
  const root = resolve(rootArg);
  if (flags.has('--replay')) {
    if (flags.has('--aplicar')) throw new Error('--replay es estrictamente offline');
    const manifest = await leerManifiestoCacheNacional(root);
    const replay = crearFetchReplayNacional(root);
    let verificados = 0;
    for (const unidad of manifest.unidades) {
      if (unidad.estado !== 'cached' && unidad.estado !== 'empty') continue;
      await (await replay(unidad.url)).arrayBuffer();
      verificados++;
    }
    console.log(JSON.stringify({ modo: 'offline-replay', peticionesRed: 0, verificados,
      ...resumirCacheNacional(manifest.unidades) }, null, 2));
    return;
  }
  const inventoryArg = valores.get('--inventario');
  if (!inventoryArg) throw new Error('Falta --inventario');
  const inventario = JSON.parse(await readFile(resolve(inventoryArg), 'utf8')) as InventarioCacheNacional;
  const tipos = valores.get('--tipos')?.split(',');
  if (tipos?.some((tipo) => tipo !== 'html' && tipo !== 'pdf')) throw new Error('Tipos permitidos: html,pdf');
  const temporadas = valores.get('--temporadas')?.split(',');
  if (temporadas?.some((s) => !/^\d{4}-\d{4}$/.test(s))) throw new Error('Temporada inválida');
  const resultado = await ejecutarLoteNacional({
    root, unidades: prepararUnidadesNacionales(inventario), aplicar: flags.has('--aplicar'),
    reintentar: flags.has('--reintentar'), temporadas, tipos: tipos as TipoDocumentoNacional[] | undefined,
    maxUnidades: valores.has('--max-unidades') ? Number(valores.get('--max-unidades')) : undefined,
    maxPeticiones: valores.has('--max-peticiones') ? Number(valores.get('--max-peticiones')) : undefined,
    maxMinutos: valores.has('--max-minutos') ? Number(valores.get('--max-minutos')) : undefined,
    windowId: valores.has('--window') ? validateWindowId(valores.get('--window')!) : undefined,
  });
  // Aggregates only: never log source URLs, raw payloads, names or parser records.
  console.log(JSON.stringify(resultado, null, 2));
  if (resultado.modo === 'download-only' &&
    resultado.motivoParada !== 'lote_completado' &&
    resultado.motivoParada !== 'sin_unidades_pendientes_seleccionadas') process.exitCode = 4;
}
main().catch(() => {
  console.error('Cache nacional detenido: argumento, checkpoint, integridad o almacenamiento inválido. No se imprimen datos privados.');
  process.exitCode = 1;
});
