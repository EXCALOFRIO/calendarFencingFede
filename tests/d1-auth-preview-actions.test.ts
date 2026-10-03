import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { COOKIE_VISTA_PREVIA, DURACION_VISTA_PREVIA, verificarVistaPrevia } from '@/lib/auth/preview-token';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';

const h = vi.hoisted(() => ({
  origin: '',
  getAuthenticatedProfile: vi.fn(),
  select: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  where: undefined as unknown,
  target: [] as { id: string }[],
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: h.origin }),
  cookies: async () => ({ set: h.set, delete: h.remove }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock('@/lib/auth/session', () => ({ getAuthenticatedProfile: h.getAuthenticatedProfile }));
vi.mock('@/db', () => ({ db: { select: h.select } }));
import { iniciarVistaPrevia, terminarAccesoQa, terminarVistaPrevia } from '@/app/vista-previa/actions';
import { GET as probar } from '@/app/probar/[quien]/route';

const ORIGIN = 'https://app.example.test';
const SECRET = 'only-a-local-test-key-at-least-thirty-two-characters';
const ADMIN = {
  authUserId: 'neon-local-test-admin',
  profileId: '11111111-1111-4111-8111-111111111111',
  role: 'admin',
};
const TARGET = '22222222-2222-4222-8222-222222222222';
function datos(role = 'athlete', profileId = TARGET) {
  const form = new FormData();
  form.set('role', role);
  form.set('profileId', profileId);
  return form;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
  vi.stubEnv('NODE_ENV', 'production');
  h.origin = ORIGIN;
  h.target = [{ id: TARGET }];
  h.set.mockReset();
  h.remove.mockReset();
  h.getAuthenticatedProfile.mockReset().mockResolvedValue(ADMIN);
  h.select.mockReset().mockImplementation(() => ({
    from: () => ({
      where: (where: unknown) => {
        h.where = where;
        return { limit: async () => h.target };
      },
    }),
  }));
});

describe('private preview issuance and explicit exits', () => {
  it.each(['', 'https://external.example.test'])('all preview/QA cookie actions reject an absent or foreign Origin (%s)', async (origin) => {
    h.origin = origin;
    for (const action of [() => iniciarVistaPrevia(datos()), terminarVistaPrevia, terminarAccesoQa]) {
      await expect(action()).rejects.toThrow('NO_AUTORIZADO');
    }
    expect(h.getAuthenticatedProfile).not.toHaveBeenCalled();
    expect(h.select).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it.each([null, { ...ADMIN, role: 'coach' }, { ...ADMIN, role: 'athlete' }])('only the real admin can issue or exit ordinary previews: %j', async (profile) => {
    h.getAuthenticatedProfile.mockResolvedValue(profile);
    await expect(iniciarVistaPrevia(datos())).rejects.toThrow('NO_AUTORIZADO');
    await expect(terminarVistaPrevia()).rejects.toThrow('NO_AUTORIZADO');
    expect(h.select).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it.each(['admin', 'coach', 'athlete'])('issues an admin-bound 30-minute %s view, never a personal session', async (role) => {
    await expect(iniciarVistaPrevia(datos(role))).rejects.toThrow('REDIRECT:/');
    expect(new SQLiteSyncDialect().sqlToQuery(h.where as never).params).toEqual([TARGET, role, 'revocada']);
    const [name, value, options] = h.set.mock.calls[0];
    expect(name).toBe(COOKIE_VISTA_PREVIA);
    expect(options).toEqual({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    const token = verificarVistaPrevia(value, SECRET, ADMIN);
    expect(token).toMatchObject({ adminAuthUserId: ADMIN.authUserId, adminProfileId: ADMIN.profileId, profileId: TARGET, role });
    expect(token!.expiresAt - token!.issuedAt).toBe(DURACION_VISTA_PREVIA * 1000);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it.each(['club', 'guardian', 'attacker'])('does not offer removed or arbitrary roles (%s)', async (role) => {
    await expect(iniciarVistaPrevia(datos(role))).rejects.toThrow('Papel no disponible.');
    expect(h.select).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it.each(['../admin', '-'.repeat(36)])('rejects malformed profile IDs (%s)', async (profileId) => {
    await expect(iniciarVistaPrevia(datos('athlete', profileId))).rejects.toThrow('Perfil no disponible.');
    expect(h.select).not.toHaveBeenCalled();
  });

  it('does not issue a cookie for a revoked, deleted or mismatched-role target', async () => {
    h.target = [];
    await expect(iniciarVistaPrevia(datos())).rejects.toThrow('Perfil no disponible.');
    expect(h.set).not.toHaveBeenCalled();
  });

  it('a D1 failure while checking the target reveals no private SQL parameters', async () => {
    h.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({ limit: async () => { throw new Error('synthetic-provider-private-parameters'); } }),
      }),
    }));
    await expect(iniciarVistaPrevia(datos())).rejects.toThrow('Perfil no disponible.');
    expect(h.set).not.toHaveBeenCalled();
  });

  it('technical QA may choose a role view without dropping its QA cookie', async () => {
    const qa = { ...ADMIN, authUserId: 'qa:local-test-grant', qa: { expiresAt: Date.now() + 60_000 } };
    h.getAuthenticatedProfile.mockResolvedValue(qa);
    await expect(iniciarVistaPrevia(datos())).rejects.toThrow('REDIRECT:/');
    expect(verificarVistaPrevia(h.set.mock.calls[0][1], SECRET, qa)).not.toBeNull();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('ordinary preview exit clears only its cookie and returns to private selection', async () => {
    await expect(terminarVistaPrevia()).rejects.toThrow('REDIRECT:/vista-previa');
    expect(h.remove.mock.calls).toEqual([[COOKIE_VISTA_PREVIA]]);
    expect(h.set).not.toHaveBeenCalled();
  });

  it('an expired technical grant can be explicitly left without touching personal auth', async () => {
    h.getAuthenticatedProfile.mockRejectedValue(new Error('VISTA_PREVIA_CADUCADA'));
    await expect(terminarAccesoQa()).rejects.toThrow('REDIRECT:/entrar');
    expect(h.remove.mock.calls).toEqual([[COOKIE_ACCESO_QA], [COOKIE_VISTA_PREVIA]]);
    expect(h.getAuthenticatedProfile).not.toHaveBeenCalled();
    expect(h.select).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });
});

describe('retired role shortcuts only navigate to the private selector', () => {
  it.each(['unknown', '__proto__', 'constructor', 'toString'])('unknown or inherited shortcut %s is unavailable', async (quien) => {
    const response = await probar(new Request(`${ORIGIN}/probar/${quien}`), { params: Promise.resolve({ quien }) });
    expect(response.status).toBe(404);
    expect(h.select).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it('anonymous access goes to login without touching any cookies or profiles', async () => {
    h.getAuthenticatedProfile.mockResolvedValue(null);
    const response = await probar(new Request(`${ORIGIN}/probar/admin`), { params: Promise.resolve({ quien: 'admin' }) });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/entrar');
    expect(h.select).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it.each(['admin', 'seleccionador', 'coach', 'tirador', 'tiradora', 'athlete'])('admin shortcut %s selects a view but never signs in another identity', async (quien) => {
    const response = await probar(new Request(`${ORIGIN}/probar/${quien}`), { params: Promise.resolve({ quien }) });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(/^https:\/\/app.example.test\/vista-previa\?rol=(admin|coach|athlete)$/);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(h.select).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it.each(['coach', 'athlete'])('non-admin %s cannot select private views', async (role) => {
    h.getAuthenticatedProfile.mockResolvedValue({ ...ADMIN, role });
    const response = await probar(new Request(`${ORIGIN}/probar/admin`), { params: Promise.resolve({ quien: 'admin' }) });
    expect(response.status).toBe(404);
    expect(h.set).not.toHaveBeenCalled();
  });
});
