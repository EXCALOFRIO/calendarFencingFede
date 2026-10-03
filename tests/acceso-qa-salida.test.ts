import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';
import { COOKIE_VISTA_PREVIA } from '@/lib/auth/preview-token';

const h = vi.hoisted(() => ({
  qa: false,
  remove: vi.fn(),
  getAuthenticatedProfile: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ has: (name: string) => name === 'calendario_acceso_qa' && h.qa, delete: h.remove }),
}));
vi.mock('@/lib/auth/session', () => ({ getAuthenticatedProfile: h.getAuthenticatedProfile }));
import { POST } from '@/app/vista-previa/salir/route';

const BASE = 'https://app.example.test';
function llamar(origin = BASE) {
  return POST(new Request(`${BASE}/vista-previa/salir`, { method: 'POST', headers: { origin } }));
}

beforeEach(() => {
  h.qa = false;
  h.remove.mockReset();
  h.getAuthenticatedProfile.mockReset().mockResolvedValue({ role: 'admin' });
});

describe('salida explícita sin recuperar silenciosamente permisos', () => {
  it('puede limpiar QA caducada sin leer Neon Auth ni consultar perfiles', async () => {
    h.qa = true;
    h.getAuthenticatedProfile.mockRejectedValue(new Error('caducado'));
    const result = await llamar();
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/entrar');
    expect(h.remove).toHaveBeenCalledWith(COOKIE_ACCESO_QA);
    expect(h.remove).toHaveBeenCalledWith(COOKIE_VISTA_PREVIA);
    expect(h.getAuthenticatedProfile).not.toHaveBeenCalled();
  });

  it.each(['', 'https://externo.example.test'])('un origen ajeno no puede cerrar la QA: %s', async (origin) => {
    h.qa = true;
    expect((await llamar(origin)).status).toBe(403);
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.getAuthenticatedProfile).not.toHaveBeenCalled();
  });

  it('conserva la salida del admin real de una preview ordinaria', async () => {
    const result = await llamar();
    expect(result.headers.get('location')).toBe('/vista-previa');
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledWith(COOKIE_VISTA_PREVIA);
  });

  it.each([null, { role: 'athlete' }, { role: 'coach' }])('sin QA exige la administración real: %j', async (perfil) => {
    h.getAuthenticatedProfile.mockResolvedValue(perfil);
    expect((await llamar()).status).toBe(403);
    expect(h.remove).not.toHaveBeenCalled();
  });
});
