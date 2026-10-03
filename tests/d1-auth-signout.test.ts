import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_COOKIES } from '@/lib/auth/cookies';
import { COOKIE_VISTA_PREVIA } from '@/lib/auth/preview-token';

const h = vi.hoisted(() => ({
  signOut: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  has: vi.fn(),
  qaExit: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ getAuth: () => ({ api: { signOut: h.signOut } }) }));
vi.mock('@/app/vista-previa/actions', () => ({ terminarAccesoQa: h.qaExit }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'https://app.example.test' }),
  cookies: async () => ({ has: h.has, set: h.set, delete: h.remove }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
import { salir } from '@/app/(app)/salir';

beforeEach(() => {
  h.signOut.mockReset().mockResolvedValue({ success: true });
  h.set.mockReset();
  h.remove.mockReset();
  h.has.mockReset().mockReturnValue(false);
  h.qaExit.mockReset().mockImplementation(() => { throw new Error('REDIRECT:/entrar'); });
});

describe('explicit server logout and scoped cookie clearing', () => {
  it('invalidates the server session before clearing only known cookies', async () => {
    await expect(salir()).rejects.toThrow('REDIRECT:/entrar');
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.signOut.mock.invocationCallOrder[0]).toBeLessThan(h.set.mock.invocationCallOrder[0]);
    expect(h.set.mock.calls.map(([name]) => name)).toEqual([...AUTH_COOKIES]);
    for (const [name, value, options] of h.set.mock.calls) {
      expect(value).toBe('');
      expect(options).toMatchObject({ path: '/', maxAge: 0, httpOnly: true, secure: name.startsWith('__Secure-') });
    }
    expect(h.remove).toHaveBeenCalledWith(COOKIE_VISTA_PREVIA);
    expect(h.remove).toHaveBeenCalledWith({ name: 'entrar_correo', path: '/entrar' });
  });

  it('does not claim logout or clear cookies if server invalidation failed', async () => {
    h.signOut.mockRejectedValue(new Error('provider error with private parameters'));
    await expect(salir()).rejects.toThrow('No se ha podido cerrar la sesión.');
    expect(h.set).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('leaving technical QA never logs out a hidden personal session', async () => {
    h.has.mockImplementation((name) => name === 'calendario_acceso_qa');
    await expect(salir()).rejects.toThrow('REDIRECT:/entrar');
    expect(h.qaExit).toHaveBeenCalledTimes(1);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('logout from preview invalidates the actual session rather than restoring admin', async () => {
    h.has.mockImplementation((name) => name === COOKIE_VISTA_PREVIA);
    await expect(salir()).rejects.toThrow('REDIRECT:/entrar');
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledWith(COOKIE_VISTA_PREVIA);
  });
});
