import { afterEach, describe, expect, it, vi } from 'vitest';

const doble = vi.hoisted(() => ({ contexto: vi.fn() }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: doble.contexto }));
import { r2Bucket, storageBackend, storeFile } from '@/lib/storage';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('almacenamiento exclusivo en Cloudflare R2', () => {
  it('no usa Neon S3 aunque existan credenciales heredadas', async () => {
    doble.contexto.mockImplementation(() => { throw new Error('sin Worker'); });
    vi.stubEnv('AWS_ENDPOINT_URL_S3', 'https://almacen-ficticio.invalid');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'clave-ficticia');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secreto-ficticio');
    const red = vi.spyOn(globalThis, 'fetch');
    try {
      expect(r2Bucket()).toBeNull();
      expect(storageBackend()).toBeNull();
      expect(await storeFile('ingest/ejemplo.html', 'contenido ficticio')).toBeNull();
      expect(red).not.toHaveBeenCalled();
    } finally {
      red.mockRestore();
    }
  });

  it('sube solo la vista de bytes indicada y devuelve una ruta con control de sesión', async () => {
    const put = vi.fn(async (_clave: string, _valor: ArrayBuffer, _opciones?: unknown) => ({}));
    doble.contexto.mockReturnValue({ env: { ARCHIVOS: { put } } });
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.invalid');
    vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://no-usar.invalid');
    const bytes = new Uint8Array([99, 1, 2, 88]).subarray(1, 3);
    expect(await storeFile('convocatorias/prueba.pdf', bytes, { contentType: 'application/pdf' }))
      .toEqual({
        backend: 'r2',
        pathname: 'convocatorias/prueba.pdf',
        url: 'https://app.invalid/api/archivos/convocatorias/prueba.pdf',
      });
    expect(put).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(put.mock.calls[0][1] as ArrayBuffer)).toEqual(new Uint8Array([1, 2]));
  });

  it.each(['', '/absoluta.pdf', '../archivo.pdf', 'carpeta/../archivo.pdf', 'carpeta\\archivo.pdf'])(
    'rechaza una ruta no válida sin escribir: %s',
    async (ruta) => {
      const put = vi.fn();
      doble.contexto.mockReturnValue({ env: { ARCHIVOS: { put } } });
      await expect(storeFile(ruta, 'contenido ficticio')).rejects.toThrow('ruta');
      expect(put).not.toHaveBeenCalled();
    },
  );
});
