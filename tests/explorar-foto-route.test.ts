import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';
import { ERROR_NO_AUTENTICADO } from '@/lib/sport/explorar/contexto';
import { perfil, UUID_A } from './helpers/explorar';

const control = vi.hoisted(() => ({ contexto: vi.fn(), lector: vi.fn() }));
vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: control.contexto }));
vi.mock('@/lib/sport/explorar/foto', () => ({ leerFotoDeportista: control.lector }));
const { GET } = await import('@/app/api/explorar/deportistas/[id]/foto/route');
const solicitar = (query = '', id = UUID_A) => GET(
  new Request(`https://aplicacion.test/api/explorar/deportistas/${id}/foto${query}`),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  control.contexto.mockReset(); control.lector.mockReset();
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

  it('entrada inválida/no disponible conserva el estado correcto y nunca se cachea', async () => {
    for (const [estado, status] of [['entrada_invalida', 400], ['no_disponible', 503], ['foto_no_publicada', 200]] as const) {
      control.lector.mockResolvedValueOnce({ estado });
      const respuesta = await solicitar();
      expect(respuesta.status).toBe(status);
      expect(respuesta.headers.get('cache-control')).toBe('private, no-store');
      expect(respuesta.headers.get('vary')).toBe('Cookie');
      expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff');
      expect(respuesta.headers.get('content-type')).toContain('application/json');
    }
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
