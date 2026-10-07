import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';
import { ERROR_NO_AUTENTICADO } from '@/lib/sport/explorar/contexto';
import { perfil, UUID_A } from './helpers/explorar';

const control = vi.hoisted(() => ({ contexto: vi.fn(), lector: vi.fn(), cubo: vi.fn(), lote: vi.fn() }));
vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: control.contexto }));
vi.mock('@/lib/storage', () => ({ r2Bucket: control.cubo }));
vi.mock('@/lib/sport/explorar/foto', () => ({ leerFotoDeportista: control.lector }));
vi.mock('@/lib/sport/explorar/foto-lote', () => ({ leerFotosDeportistas: control.lote, MAX_FOTOS_POR_LOTE: 24 }));
const { GET } = await import('@/app/api/explorar/deportistas/[id]/foto/route');
const { GET: GET_LOTE } = await import('@/app/api/explorar/fotos/route');
const solicitar = (query = '', id = UUID_A) => GET(
  new Request(`https://aplicacion.test/api/explorar/deportistas/${id}/foto${query}`),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  control.contexto.mockReset(); control.lector.mockReset(); control.cubo.mockReset(); control.lote.mockReset();
  control.cubo.mockReturnValue(null);
  control.contexto.mockReturnValue({ perfil: async () => perfil() });
  control.lector.mockResolvedValue({ estado: 'foto_no_publicada' });
});

describe('ruta privada de metadatos oficiales', () => {
  it('sin sesión o con acceso revocado devuelve 401 antes de leer la persona', async () => {
    control.contexto.mockReturnValue({ perfil: async () => null });
    const respuesta = await solicitar('?url=https://otro.test');
    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ estado: 'no_autenticado' });
    expect(control.lector).not.toHaveBeenCalled();
  });

  it('preview válida admite lectura sin exigir escritura y no expone su identidad', async () => {
    control.contexto.mockReturnValue({
      perfil: async () => perfil({ preview: { adminProfileId: 'privado', expiresAt: 9e9 } }),
    });
    const respuesta = await solicitar();
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ estado: 'foto_no_publicada' });
    expect(control.lector).toHaveBeenCalledTimes(1);
    const ctx = control.lector.mock.calls[0][0];
    expect((await ctx.perfil()).preview.adminProfileId).toBe('privado');
  });

  it('preview caducada o revocada produce 401 sin filtrar el error', async () => {
    control.contexto.mockReturnValue({ perfil: async () => {
      throw Object.assign(new Error('metadatos privados'), { digest: ERROR_VISTA_CADUCADA });
    } });
    const respuesta = await solicitar();
    expect(respuesta.status).toBe(401);
    expect(await respuesta.text()).not.toMatch(/privados|digest|profileId/);
    expect(control.lector).not.toHaveBeenCalled();
  });

  it.each(['?url=https://otro.test', '?ancho=9999', '?id=123'])('rechaza parámetros cliente %s: no es un proxy de URLs', async (query) => {
    expect((await solicitar(query)).status).toBe(400);
    expect(control.lector).not.toHaveBeenCalled();
  });

  it('sólo lo definitivo se reutiliza, y sólo en el navegador con sesión; los errores nunca', async () => {
    for (const [estado, status, cache] of [
      ['entrada_invalida', 400, 'private, no-store'],
      ['no_disponible', 503, 'private, no-store'],
      ['foto_no_publicada', 200, 'private, max-age=86400, stale-while-revalidate=604800'],
    ] as const) {
      control.lector.mockResolvedValueOnce({ estado });
      const respuesta = await solicitar();
      expect(respuesta.status).toBe(status);
      expect(respuesta.headers.get('cache-control')).toBe(cache);
      expect(respuesta.headers.get('vary')).toBe('Cookie');
      expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff');
      expect(respuesta.headers.get('content-type')).toContain('application/json');
    }
  });

  it('con R2 pasa un almacén de marcas; sin binding (local, Vitest) sigue sin él', async () => {
    await solicitar();
    expect(control.lector.mock.calls[0][2].almacen).toBeNull();
    const cubo = { get: vi.fn(async () => null), put: vi.fn(async () => ({})) };
    control.cubo.mockReturnValue(cubo);
    await solicitar();
    const almacen = control.lector.mock.calls[1][2].almacen;
    expect(await almacen.leer('fotos/fie/1.json')).toBeNull();
    expect(cubo.get).toHaveBeenCalledWith('fotos/fie/1.json');
  });

  it('perder sesión durante la lectura es 401, error interno es 503 sin detalles', async () => {
    control.lector.mockRejectedValueOnce(new Error(ERROR_NO_AUTENTICADO));
    expect((await solicitar()).status).toBe(401);
    control.lector.mockRejectedValueOnce(new Error('URL, datos privados y SQL'));
    const respuesta = await solicitar();
    expect(respuesta.status).toBe(503);
    expect(await respuesta.json()).toEqual({ estado: 'no_disponible' });
  });
});

describe('ruta de fotos en lote', () => {
  const lote = (query: string) => GET_LOTE(new Request(`https://aplicacion.test/api/explorar/fotos${query}`));

  it('sin sesión es 401 antes de leer nada', async () => {
    control.contexto.mockReturnValue({ perfil: async () => null });
    expect((await lote(`?ids=${UUID_A}`)).status).toBe(401);
    expect(control.lote).not.toHaveBeenCalled();
  });

  it.each([
    '', '?ids=', '?ids=no-uuid', `?ids=${UUID_A}&url=https://otro.test`, `?ids=${UUID_A}&ids=${UUID_A}`,
    `?ids=${Array.from({ length: 25 }, () => UUID_A).join(',')}`,
  ])('rechaza %s sin leer nada', async (query) => {
    expect((await lote(query)).status).toBe(400);
    expect(control.lote).not.toHaveBeenCalled();
  });

  it('un lote entero definitivo se reutiliza en el navegador; con algo pendiente, no', async () => {
    control.lote.mockResolvedValueOnce({ estado: 'ok', fotos: { [UUID_A]: { estado: 'foto_no_publicada' } } });
    const definitivo = await lote(`?ids=${UUID_A}`);
    expect(definitivo.status).toBe(200);
    expect(definitivo.headers.get('cache-control')).toBe('private, max-age=86400, stale-while-revalidate=604800');
    expect(definitivo.headers.get('vary')).toBe('Cookie');
    expect(control.lote.mock.calls[0][1]).toEqual([UUID_A]);

    control.lote.mockResolvedValueOnce({ estado: 'ok', fotos: { [UUID_A]: { estado: 'pendiente' } } });
    expect((await lote(`?ids=${UUID_A}`)).headers.get('cache-control')).toBe('private, no-store');
  });

  it('un error interno es 503 sin detalles', async () => {
    control.lote.mockRejectedValueOnce(new Error('SQL y datos privados'));
    const r = await lote(`?ids=${UUID_A}`);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ estado: 'no_disponible' });
  });
});