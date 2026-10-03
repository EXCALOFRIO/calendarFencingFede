import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CuboR2 } from '@/lib/storage';
import { prepararParticionesArchivoLocal } from '@/lib/ingest/archivo-local';
import { archivarParticionesVerificadas } from '@/lib/ingest/archivo-campana-r2';
import { hashArchivo, claveBlobArchivo, MAX_MANIFIESTO_ARCHIVO } from '@/lib/ingest/archivo-r2';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'archivo-campana-')); roots.push(root);
  const endpoints: Record<string, unknown> = {};
  const files: string[] = [];
  for (let i = 0; i < 3; i++) {
    const body = new TextEncoder().encode(`SYNTHETIC ORIGINAL ${i}`), hash = hashArchivo(body);
    const dir = join(root, 'blobs', hash.slice(0, 2)); await mkdir(dir, { recursive: true });
    const file = join(dir, `${hash}.blob`); await writeFile(file, body); files.push(file);
    // The third blob is an interrupted original with no source reference.
    if (i < 2) endpoints[String(i)] = {
      url: `https://fie.org/api/fie/fixture/${i}`, blobSha256: hash, bytes: body.length, status: 200,
    };
  }
  const original = Buffer.from(JSON.stringify({ version: 1, units: {}, endpoints }));
  await writeFile(join(root, 'manifest.json'), original);
  const plan = await prepararParticionesArchivoLocal(root, 'fie', { maxBlobsPorLote: 2 });
  return { root, files, original, plan };
}
function bucket() {
  const objects = new Map<string, Uint8Array>();
  let active = 0, maximum = 0;
  const put = vi.fn(async (key: string, body: ArrayBuffer) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    objects.set(key, new Uint8Array(body)); active--;
  });
  const cubo: CuboR2 = {
    put, get: async (key) => {
      const b = objects.get(key);
      return b ? { size: b.length, httpEtag: 'fixture', body: new Blob([b.slice().buffer]).stream() } : null;
    },
  };
  return { cubo, objects, put, maximum: () => maximum };
}
describe('full original archive through bounded verified partitions', () => {
  it('verifies all referenced and orphan originals, partitions them and preserves exact source metadata', async () => {
    const f = await fixture();
    expect(f.plan.blobs).toHaveLength(3); expect(f.plan.particiones).toHaveLength(2);
    expect(f.plan.originalSha256).toBe(hashArchivo(f.original));
    expect(f.plan.particiones.every((p) => p.blobs.length <= 2 && p.manifest.length <= MAX_MANIFIESTO_ARCHIVO)).toBe(true);
    expect(f.plan.particiones.flatMap((p) => p.referencias)).toHaveLength(2);
    expect(await readFile(join(f.root, 'manifest.json'))).toEqual(f.original);
  });
  it('never relaxes the per-part manifest limit even for a larger exact original manifest', async () => {
    const f = await fixture(), m = JSON.parse(f.original.toString('utf8'));
    await writeFile(join(f.root, 'manifest.json'), JSON.stringify({ ...m, otherMetadata: 'x'.repeat(MAX_MANIFIESTO_ARCHIVO) }));
    const plan = await prepararParticionesArchivoLocal(f.root, 'fie', { maxBlobsPorLote: 2 });
    expect(plan.original.length).toBeGreaterThan(MAX_MANIFIESTO_ARCHIVO);
    expect(plan.particiones.every((p) => p.manifest.length < MAX_MANIFIESTO_ARCHIVO)).toBe(true);
  });
  it('rejects corrupted unreferenced blobs rather than hiding them as unselected', async () => {
    const f = await fixture(); await writeFile(f.files[2], 'corrupt');
    await expect(prepararParticionesArchivoLocal(f.root, 'fie')).rejects.toThrow('archive_local_integrity_failure');
  });
  it.each([0, 3501, Number.NaN])('rejects invalid per-batch ceilings %s', async (maxBlobsPorLote) => {
    const f = await fixture();
    await expect(prepararParticionesArchivoLocal(f.root, 'fie', { maxBlobsPorLote })).rejects.toThrow('archive_partition_invalid');
  });
  it('uploads at bounded concurrency, re-reads every object and publishes the index last', async () => {
    const f = await fixture(), b = bucket();
    const r = await archivarParticionesVerificadas(b.cubo, f.plan, { concurrencia: 2, maxMs: 10000 });
    expect(r).toMatchObject({ modo: 'verificado', blobs: 3, particiones: 2, guardados: 3, reutilizados: 0 });
    expect(b.maximum()).toBeLessThanOrEqual(2);
    expect(b.put.mock.calls.at(-1)?.[0]).toBe(r.claveIndice);
    expect(b.objects.get(claveBlobArchivo(f.plan.originalSha256))).toEqual(new Uint8Array(f.original));
    const second = await archivarParticionesVerificadas(b.cubo, f.plan, { concurrencia: 2, maxMs: 10000 });
    expect(second).toMatchObject({ guardados: 0, reutilizados: 3 });
    expect(b.put).toHaveBeenCalledTimes(7);
  });
  it('drains active jobs after a put failure and never publishes any campaign manifest', async () => {
    const f = await fixture(), b = bucket();
    b.put.mockRejectedValueOnce(new Error('synthetic put failure'));
    await expect(archivarParticionesVerificadas(b.cubo, f.plan, { concurrencia: 2, maxMs: 10000 })).rejects.toThrow();
    expect(b.put.mock.calls.every(([key]) => key.includes('/blobs/'))).toBe(true);
  });
  it('rechecks local bytes before upload and never replaces an existing conflicting object', async () => {
    const f = await fixture(), b = bucket();
    await writeFile(f.plan.blobs[0].path, 'corrupt');
    await expect(archivarParticionesVerificadas(b.cubo, f.plan, { concurrencia: 1, maxMs: 10000 }))
      .rejects.toThrow('archive_local_integrity_failure');
    expect(b.put).not.toHaveBeenCalled();
  });
  it('does not turn a finite deadline into an implicit fresh window', async () => {
    const f = await fixture(), b = bucket(); let calls = 0;
    await expect(archivarParticionesVerificadas(b.cubo, f.plan, {
      concurrencia: 1, maxMs: 1, ahora: () => ++calls < 2 ? 0 : 2,
    })).rejects.toThrow('archive_time_budget');
    expect(b.put).not.toHaveBeenCalled();
  });
});
