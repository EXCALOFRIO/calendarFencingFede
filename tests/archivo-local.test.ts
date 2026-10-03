import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepararArchivoLocal } from '@/lib/ingest/archivo-local';
import { hashArchivo } from '@/lib/ingest/archivo-r2';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))); });
async function fixture(fuente: 'fie' | 'rfee') {
  const root = await mkdtemp(join(tmpdir(), 'archivo-fixture-'));
  roots.push(root);
  const bytes = new TextEncoder().encode('fixture original');
  const hash = hashArchivo(bytes);
  const dir = fuente === 'fie' ? join(root, 'blobs', hash.slice(0, 2)) : join(root, 'blobs');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${hash}.${fuente === 'fie' ? 'blob' : 'bin'}`);
  await writeFile(path, bytes);
  const ref = { url: 'https://fie.org/api/fie/fixture', bytes: bytes.length, contentType: 'text/plain' };
  const manifest = fuente === 'fie'
    ? { version: 1, endpoints: { fixture: { ...ref, blobSha256: hash, status: 200, completeness: 'partial' } } }
    : { version: 1, unidades: [{ ...ref, url: 'https://app.skermo.org/fixture', sha256: hash, httpStatus: 200, estado: 'cached' }] };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, path, hash, bytes, manifest };
}

describe('preflight local de originales históricos', () => {
  it.each(['fie', 'rfee'] as const)('verifica todos los blobs %s sin escribir ni consultar fuentes', async (fuente) => {
    const local = await fixture(fuente);
    const plan = await prepararArchivoLocal(local.root, fuente);
    expect(plan.blobs).toHaveLength(1);
    expect(plan.blobs[0]).toMatchObject({ hash: local.hash, bytes: local.bytes.length });
    expect(plan.referencias[0]).toMatchObject({ sha256: local.hash, status: 200 });
    expect(JSON.parse(new TextDecoder().decode(plan.manifest))).toEqual(local.manifest);
  });

  it('rechaza un blob corrupto antes de preparar una subida', async () => {
    const local = await fixture('fie');
    await writeFile(local.path, 'corrupto');
    await expect(prepararArchivoLocal(local.root, 'fie')).rejects.toThrow('local_integrity_failure');
  });

  it('rechaza referencias ausentes y rutas que no son hashes', async () => {
    const local = await fixture('rfee');
    await rm(local.path);
    await expect(prepararArchivoLocal(local.root, 'rfee')).rejects.toThrow('reference_missing');
    await writeFile(join(local.root, 'blobs', 'ajeno.bin'), 'fixture');
    await expect(prepararArchivoLocal(local.root, 'rfee')).rejects.toThrow('blob_path_invalid');
    await expect(prepararArchivoLocal('ruta-relativa', 'fie')).rejects.toThrow('absolute_root_required');
  });
});
