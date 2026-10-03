/** Local archive executor with bounded concurrency; no source download or database writer. */
import type { CuboR2 } from '@/lib/storage';
import {
  claveBlobArchivo, claveManifiestoArchivo, guardarArchivoVerificado, hashArchivo, MAX_MANIFIESTO_ARCHIVO,
} from './archivo-r2';
import { leerBlobArchivadoLocal, type ParticionesArchivoLocal } from './archivo-local';

export async function archivarParticionesVerificadas(
  cubo: CuboR2, plan: ParticionesArchivoLocal,
  options: { concurrencia: number; maxMs: number; ahora?: () => number;
    checkpoint?: (r: { verificados: number; guardados: number; reutilizados: number }) => void | Promise<void> },
) {
  if (!Number.isInteger(options.concurrencia) || options.concurrencia < 1 || options.concurrencia > 8 ||
    !Number.isInteger(options.maxMs) || options.maxMs < 1 || options.maxMs > 1_800_000) throw new Error('archive_campaign_arguments');
  const now = options.ahora ?? Date.now, deadline = now() + options.maxMs;
  let next = 0, guardados = 0, reutilizados = 0, failed = false;
  const check = () => { if (failed || now() >= deadline) throw new Error('archive_time_budget'); };
  const workers = Array.from({ length: options.concurrencia }, async () => {
    while (next < plan.blobs.length) {
      check();
      const blob = plan.blobs[next++];
      try {
        const bytes = await leerBlobArchivadoLocal(blob);
        check();
        const outcome = await guardarArchivoVerificado(cubo, blob.clave, bytes, blob.hash, 'application/octet-stream');
        if (outcome === 'guardado') guardados++; else reutilizados++;
        if ((guardados + reutilizados) % 100 === 0) {
          await options.checkpoint?.({ verificados: guardados + reutilizados, guardados, reutilizados });
        }
      } catch (error) { failed = true; throw error; }
    }
  });
  // Drain every in-flight operation even after one failed. Never publish a
  // manifest in that state or retry an ambiguous put automatically.
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find((r) => r.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  check();
  await guardarArchivoVerificado(cubo, claveBlobArchivo(plan.originalSha256),
    plan.original, plan.originalSha256, 'application/json');
  for (const part of plan.particiones) {
    check();
    await guardarArchivoVerificado(cubo, part.clave, part.manifest, part.hash, 'application/json');
  }
  const index = new TextEncoder().encode(JSON.stringify({
    format: 'calendario-archivo-campana', version: 1, fuente: plan.fuente,
    manifiestoOrigenSha256: plan.originalSha256, blobs: plan.blobs.length, bytes: plan.bytes,
    particiones: plan.particiones.map((p) => ({ sha256: p.hash, clave: p.clave, blobs: p.blobs.length })),
  }));
  if (index.byteLength > MAX_MANIFIESTO_ARCHIVO) throw new Error('archive_manifest_limit');
  check();
  const hash = hashArchivo(index), key = claveManifiestoArchivo(plan.fuente, hash);
  await guardarArchivoVerificado(cubo, key, index, hash, 'application/json');
  return { modo: 'verificado', blobs: plan.blobs.length, particiones: plan.particiones.length,
    guardados, reutilizados, bytes: plan.bytes, manifiestoOrigenSha256: plan.originalSha256,
    indiceSha256: hash, claveIndice: key };
}
