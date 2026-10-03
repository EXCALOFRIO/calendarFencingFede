import { describe, expect, it, vi } from 'vitest';
import type { CuboR2 } from '@/lib/storage';
import {
  claveBlobArchivo, claveManifiestoArchivo, crearFetchArchivoR2, guardarArchivoVerificado,
  hashArchivo, leerArchivoR2, MAX_BLOB_ARCHIVO,
} from '@/lib/ingest/archivo-r2';

function cuboFixture() {
  const objetos = new Map<string, Uint8Array>();
  const put = vi.fn(async (key: string, body: ArrayBuffer) => { objetos.set(key, new Uint8Array(body)); });
  const cubo: CuboR2 = {
    put,
    get: async (key) => {
      const bytes = objetos.get(key);
      return bytes ? { size: bytes.byteLength, httpEtag: 'fixture', body: new Blob([bytes.slice().buffer]).stream() } : null;
    },
  };
  return { cubo, objetos, put };
}
describe('archivo histórico privado e inmutable en R2', () => {
  it('guarda y verifica los bytes originales, y reutiliza el mismo hash', async () => {
    const { cubo, put } = cuboFixture();
    const bytes = new TextEncoder().encode('{"original":true}');
    const hash = hashArchivo(bytes), key = claveBlobArchivo(hash);
    expect(await guardarArchivoVerificado(cubo, key, bytes, hash, 'application/json')).toBe('guardado');
    expect(await guardarArchivoVerificado(cubo, key, bytes, hash, 'application/json')).toBe('reutilizado');
    expect(put).toHaveBeenCalledTimes(1);
    expect(await leerArchivoR2(cubo, key, 100)).toEqual(bytes);
    expect(claveManifiestoArchivo('fie', hash)).toMatch(/^historico-interno\/v1\/manifiestos\/fie\//);
  });

  it('rechaza un objeto existente distinto sin sobrescribirlo', async () => {
    const { cubo, objetos, put } = cuboFixture();
    const bytes = new TextEncoder().encode('original'), hash = hashArchivo(bytes);
    objetos.set(claveBlobArchivo(hash), new TextEncoder().encode('corrupto'));
    await expect(guardarArchivoVerificado(cubo, claveBlobArchivo(hash), bytes, hash, 'text/plain')).rejects.toThrow('existing_corrupt');
    expect(put).not.toHaveBeenCalled();
  });

  it('rechaza hash o claves no válidos antes de tocar R2', async () => {
    const { cubo, put } = cuboFixture();
    const bytes = new TextEncoder().encode('fixture');
    expect(() => claveBlobArchivo('../privado')).toThrow('hash_invalid');
    await expect(guardarArchivoVerificado(cubo, 'convocatorias/fixture', bytes, hashArchivo(bytes), 'text/plain')).rejects.toThrow('upload_invalid');
    await expect(leerArchivoR2(cubo, 'historico-interno/v1/../privado', 10)).rejects.toThrow('read_invalid');
    expect(put).not.toHaveBeenCalled();
  });

  it.each([{ size: 5, body: 'abc', error: 'stream_partial' }, { size: 2, body: 'abc', error: 'stream_limit' }])(
    'rechaza streams incompletos o mayores que el tamaño declarado',
    async ({ size, body, error }) => {
      const bytes = new TextEncoder().encode(body);
      const cubo = { get: async () => ({ size, body: new Blob([bytes]).stream(), httpEtag: 'fixture' }) } as unknown as CuboR2;
      await expect(leerArchivoR2(cubo, claveBlobArchivo(hashArchivo(bytes)), 10)).rejects.toThrow(error);
    },
  );

  it('rechaza metadatos de tamaño excesivo antes de leer el stream', async () => {
    const cubo = { get: async () => ({ size: MAX_BLOB_ARCHIVO + 1, body: new Blob([]).stream() }) } as unknown as CuboR2;
    await expect(leerArchivoR2(cubo, claveBlobArchivo('a'.repeat(64)), MAX_BLOB_ARCHIVO)).rejects.toThrow('size_invalid');
  });

  it('reproduce GET/HEAD exactos sin peticiones de fuente ni fallback', async () => {
    const { cubo, objetos } = cuboFixture();
    const bytes = new TextEncoder().encode('{"fixture":42}'), hash = hashArchivo(bytes);
    objetos.set(claveBlobArchivo(hash), bytes);
    const fetch = crearFetchArchivoR2(cubo, [{ url: 'https://fie.org/api/fie/fixture', sha256: hash, bytes: bytes.length, status: 200, contentType: 'application/json' }]);
    expect(await (await fetch('https://fie.org/api/fie/fixture')).json()).toEqual({ fixture: 42 });
    expect(await (await fetch('https://fie.org/api/fie/fixture', { method: 'HEAD' })).text()).toBe('');
    await expect(fetch('https://fie.org/api/fie/no-cache')).rejects.toThrow('cache_miss');
    await expect(fetch('https://fie.org/api/fie/fixture', { method: 'POST' })).rejects.toThrow('cache_miss');
    objetos.set(claveBlobArchivo(hash), new TextEncoder().encode('corrupto'));
    await expect(fetch('https://fie.org/api/fie/fixture')).rejects.toThrow('integrity_failure');
  });

  it('no convierte errores de fuente ni referencias contradictorias en éxito', async () => {
    const { cubo } = cuboFixture();
    const ref = { url: 'https://app.skermo.org/fixture', sha256: 'a'.repeat(64), bytes: 1, status: 503, contentType: 'text/plain' };
    await expect(crearFetchArchivoR2(cubo, [ref])(ref.url)).rejects.toThrow('source_not_success');
    expect(() => crearFetchArchivoR2(cubo, [ref, { ...ref, sha256: 'b'.repeat(64) }])).toThrow('reference_conflict');
    expect(() => crearFetchArchivoR2(cubo, [{ ...ref, url: 'https://externo.example/fixture' }])).toThrow('reference_invalid');
  });
});
