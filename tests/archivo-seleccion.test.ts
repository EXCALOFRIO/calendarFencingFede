import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepararSeleccionArchivoLocal, prepararArchivoLocal, leerBlobArchivadoLocal,
  LIMITES_SELECCION_ARCHIVO, type SeleccionArchivoLocal,
} from '@/lib/ingest/archivo-local';
import { hashArchivo, MAX_MANIFIESTO_ARCHIVO } from '@/lib/ingest/archivo-r2';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const selected: SeleccionArchivoLocal[] = [{ tipo: 'fie', season: 2027, competitionId: 77 }];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'archivo-seleccion-')); roots.push(root);
  const bytes = new TextEncoder().encode('SYNTHETIC SOURCE');
  const hash = hashArchivo(bytes), dir = join(root, 'blobs', hash.slice(0, 2));
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${hash}.blob`); await writeFile(path, bytes);
  const key = 'fie|FIE|2027|77', endpoint = '/api/fie/competition/2027/77';
  const ref = { key: `${key}|${endpoint}`, unitKey: key, endpoint,
    url: `https://fie.org${endpoint}`, blobSha256: hash, bytes: bytes.length, status: 200, contentType: 'application/json' };
  const manifest = { version: 1,
    units: { [key]: { key, season: 2027, competitionId: 77, endpoints: [endpoint] } },
    endpoints: { [ref.key]: ref },
  };
  const save = () => writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await save(); return { root, path, dir, bytes, hash, key, ref, manifest, save };
}

describe('bounded, selected historical archive planning', () => {
  it('keeps exact selected provenance and the original manifest digest without changing cache bytes', async () => {
    const f = await fixture(), original = await readFile(join(f.root, 'manifest.json'));
    const p = await prepararSeleccionArchivoLocal(f.root, 'fie', selected);
    expect(p.blobs).toHaveLength(1); expect(p.referencias).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode(p.manifest))).toMatchObject({
      units: f.manifest.units, endpoints: f.manifest.endpoints,
      seleccion: { version: 1, manifiestoOrigenSha256: hashArchivo(original), unidades: selected },
    });
    expect(hashArchivo(p.manifest)).toBe(p.hash);
    expect(await leerBlobArchivadoLocal(p.blobs[0])).toEqual(f.bytes);
    expect(await readFile(join(f.root, 'manifest.json'))).toEqual(original);
  });
  it('does not certify or read more than 3500 unrelated, even missing or corrupt, blobs', async () => {
    const f = await fixture();
    for (let i = 0; i < 3_501; i++) {
      const key = `other-${i}`;
      f.manifest.endpoints[key] = { ...f.ref, key, unitKey: key,
        blobSha256: i.toString(16).padStart(64, '0'), url: 'https://invalid.example/unselected' };
    }
    await f.save();
    await writeFile(join(f.dir, 'unrelated-invalid-file'), 'corrupt unselected fixture');
    const p = await prepararSeleccionArchivoLocal(f.root, 'fie', selected);
    expect(p.blobs).toHaveLength(1);
    expect(Object.keys(JSON.parse(new TextDecoder().decode(p.manifest)).endpoints)).toEqual([f.ref.key]);
    await expect(prepararArchivoLocal(f.root, 'fie')).rejects.toThrow();
  });
  it('accepts bounded larger source metadata but never raises the R2 manifest cap', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'manifest.json'), JSON.stringify({ ...f.manifest, unselected: 'x'.repeat(MAX_MANIFIESTO_ARCHIVO) }));
    const p = await prepararSeleccionArchivoLocal(f.root, 'fie', selected);
    expect(p.manifest.byteLength).toBeLessThan(MAX_MANIFIESTO_ARCHIVO);
    await expect(prepararArchivoLocal(f.root, 'fie')).rejects.toThrow('archive_manifest_limit');
  });
  it('rejects an oversized source manifest before allocating or parsing it', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'manifest.json'), Buffer.alloc(LIMITES_SELECCION_ARCHIVO.manifiestoOrigen + 1));
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selected)).rejects.toThrow('archive_source_manifest_limit');
  });
  it('rejects selected corruption and a second-read content change', async () => {
    const f = await fixture(), p = await prepararSeleccionArchivoLocal(f.root, 'fie', selected);
    await writeFile(f.path, 'corrupt');
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selected)).rejects.toThrow('archive_local_integrity_failure');
    await expect(leerBlobArchivadoLocal(p.blobs[0])).rejects.toThrow('archive_local_integrity_failure');
  });
  it('fails on a missing selected blob, but an absent selection has no fabricated references', async () => {
    const f = await fixture(); await rm(f.path);
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selected)).rejects.toThrow('archive_local_reference_missing');
    const p = await prepararSeleccionArchivoLocal(f.root, 'fie', [{ tipo: 'fie', season: 2027, competitionId: 78 }]);
    expect(p.blobs).toEqual([]); expect(p.referencias).toEqual([]);
  });
  it('checks the total selected byte budget before reading blobs', async () => {
    const f = await fixture();
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selected, { maxBytes: 1 })).rejects.toThrow('archive_campaign_limit');
  });
  it('checks the caller deadline throughout preflight', async () => {
    const f = await fixture(); let n = 0;
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selected, { comprobar: () => {
      if (++n === 3) throw new Error('fixture_deadline');
    } })).rejects.toThrow('fixture_deadline');
  });
  it.each([
    { url: 'https://fie.org:444/api/fie/competition/2027/77' },
    { url: 'https://user@fie.org/api/fie/competition/2027/77' },
    { url: 'https://fie.org/api/fie/competition/2027/77#fragment' },
    { bytes: -1 }, { bytes: 33 * 1024 * 1024 }, { blobSha256: '' },
    { status: '200' }, { contentType: 'text/plain\r\nX-Injected: 1' },
  ])('rejects invalid selected metadata %#', async (override) => {
    const f = await fixture(); Object.assign(f.ref, override); await f.save();
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selected)).rejects.toThrow('archive_reference_invalid');
  });
  it('rejects duplicate URL hashes instead of choosing a payload silently', async () => {
    const f = await fixture();
    f.manifest.endpoints.other = { ...f.ref, key: 'other', blobSha256: 'a'.repeat(64) };
    await f.save();
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selected)).rejects.toThrow('archive_reference_conflict');
  });
  it('deduplicates shared blobs while preserving every original reference', async () => {
    const f = await fixture();
    f.manifest.endpoints.other = { ...f.ref, key: 'other', url: `${f.ref.url}/results/ranking` };
    await f.save();
    const p = await prepararSeleccionArchivoLocal(f.root, 'fie', selected);
    expect(p.blobs).toHaveLength(1); expect(p.referencias).toHaveLength(2);
  });
  it('rejects selected directory junctions without requiring Windows file-symlink privileges', async () => {
    const f = await fixture(), other = await mkdtemp(join(tmpdir(), 'archivo-junction-')); roots.push(other);
    await rm(f.dir, { recursive: true });
    await writeFile(join(other, `${f.hash}.blob`), f.bytes);
    await symlink(other, f.dir, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selected)).rejects.toThrow('archive_blob_path_invalid');
  });
  it('retains partial national state, source association and empty bodies without certifying extraction', async () => {
    const f = await fixture(), hash = hashArchivo(new Uint8Array()), id = `pdf-${'b'.repeat(64)}`;
    await writeFile(join(f.root, 'blobs', `${hash}.bin`), new Uint8Array());
    const u = { id, tipo: 'pdf', url: 'https://app.skermo.org/client/1/fixture.pdf',
      sha256: hash, bytes: 0, httpStatus: 200, estado: 'partial', asociaciones: [{ temporada: '2026-2027' }] };
    await writeFile(join(f.root, 'manifest.json'), JSON.stringify({ version: 1, unidades: [u] }));
    const p = await prepararSeleccionArchivoLocal(f.root, 'rfee', [{ tipo: 'pdf', id }]);
    expect(p.blobs).toHaveLength(1); expect(p.blobs[0].bytes).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(p.manifest)).unidades).toEqual([u]);
  });
  it.each([
    [], [...selected, ...selected],
    [{ tipo: 'fie', season: 1999, competitionId: 77 }],
    [{ tipo: 'fie', season: 2027, competitionId: 0 }],
    [{ tipo: 'pdf', id: 'pdf-invalid' }],
    Array.from({ length: 251 }, (_, i) => ({ tipo: 'fie', season: 2027, competitionId: i + 1 })),
  ].map((selections) => [selections]))('rejects unbounded or invalid selections %#', async (selections) => {
    const f = await fixture();
    await expect(prepararSeleccionArchivoLocal(f.root, 'fie', selections as SeleccionArchivoLocal[])).rejects.toThrow('archive_selection_invalid');
  });
});
