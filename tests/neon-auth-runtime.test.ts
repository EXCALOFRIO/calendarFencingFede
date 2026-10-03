import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { localD1 } from '@/db/d1/testing';

const h = vi.hoisted(() => ({
  binding: undefined as unknown,
  set: vi.fn(),
}));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: { DB: h.binding } }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: h.set }) }));
import { getAuth } from '@/lib/auth/server';

const ORIGIN = 'https://app.example.test';
const PROVIDER = 'https://managed.example.test/neon_auth';
const EMAIL = 'fixture@example.test';
const SECRET = 'synthetic-neon-cookie-key-at-least-thirty-two-characters';
const USER = {
  id: 'managed-fixture-user', name: '', email: EMAIL, emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
let local: ReturnType<typeof localD1>;
let fetchMock: ReturnType<typeof vi.fn>;
let active: boolean;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
  vi.stubEnv('NEON_AUTH_URL', PROVIDER);
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
  vi.stubEnv('NODE_ENV', 'production');
  // These unrelated credentials must never be needed by authentication.
  vi.stubEnv('DATABASE_URL', 'postgres://unused.invalid');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('EMAIL_FROM', '');
  vi.stubEnv('BETTER_AUTH_SECRET', '');
  local = localD1(); h.binding = local.binding; active = false; h.set.mockReset();
  local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0001_auth.sql', import.meta.url), 'utf8'));
  local.sqlite.prepare('INSERT INTO user_profile (id,email,full_name,role,ical_token) VALUES (?,?,?,?,?)')
    .run('fixture-profile', EMAIL, 'Fixture', 'athlete', 'fixture-feed');
  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    expect(url.origin).toBe('https://managed.example.test');
    if (url.pathname.endsWith('/get-session')) return Response.json(active ? {
      user: USER,
      session: {
        id: 'synthetic-session', token: 'never-return-as-json', userId: USER.id,
        createdAt: USER.createdAt, updatedAt: USER.updatedAt,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    } : null);
    if (url.pathname.endsWith('/send-verification-otp')) return Response.json({ success: true });
    if (url.pathname.endsWith('/sign-out')) {
      active = false;
      return Response.json({ success: true }, { headers: { 'set-cookie': '__Secure-neon-auth.session_token=; Max-Age=0; Path=/; Secure; HttpOnly' } });
    }
    expect(url.pathname).toBe('/neon_auth/sign-in/email-otp');
    expect(JSON.parse(String(init?.body))).toEqual({ email: EMAIL, otp: '123456' });
    active = true;
    return Response.json({ user: USER, token: 'never-return-as-json' }, {
      headers: { 'set-cookie': '__Secure-neon-auth.session_token=synthetic-token; Path=/; Secure; HttpOnly; SameSite=Lax' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  h.binding = undefined; local.close();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
function headers() { return new Headers({ origin: ORIGIN, 'cf-connecting-ip': '192.0.2.1' }); }

describe('real installed Neon SDK, entirely offline, with native D1', () => {
  it('signs in using the existing managed API and applies scoped secure cookies after authorization', async () => {
    const auth = getAuth();
    await auth.api.sendVerificationOTP({ headers: headers(), body: { email: EMAIL, type: 'sign-in' } });
    expect(h.set).not.toHaveBeenCalled();
    const result = await auth.api.signInEmailOTP({ headers: headers(), body: { email: EMAIL, otp: '123456' } });
    expect(result).toEqual({ user: { id: USER.id, email: EMAIL, emailVerified: true } });
    expect(h.set).toHaveBeenCalledWith('__Secure-neon-auth.session_token', expect.any(String), expect.objectContaining({
      httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    }));
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile').get()!.auth_user_id).toBe(USER.id);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith(PROVIDER))).toBe(true);
  });
  it('authoritative reads bypass the SDK cookie cache and do not return the provider token', async () => {
    active = true;
    local.sqlite.prepare('UPDATE user_profile SET auth_user_id=?').run(USER.id);
    const result = await getAuth().api.getSession({ headers: headers() });
    expect(result?.user.id).toBe(USER.id);
    expect(result).not.toHaveProperty('session.token');
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('disableCookieCache')).toBe('true');
    expect(h.set).not.toHaveBeenCalled();
  });
  it('a provider error never sets application cookies or leaks the provider body', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'synthetic-private-provider-message' }, {
      status: 500, headers: { 'set-cookie': '__Secure-neon-auth.session_token=must-not-copy' },
    }));
    await expect(getAuth().api.getSession({ headers: headers() })).rejects.toThrow('ACCESO_NO_PERMITIDO');
    expect(h.set).not.toHaveBeenCalled();
  });
  it('logout confirms revocation through the installed SDK before applying deletion cookies', async () => {
    active = true;
    await getAuth().api.signOut({ headers: new Headers({ origin: ORIGIN, cookie: '__Secure-neon-auth.session_token=synthetic-token' }) });
    expect(active).toBe(false);
    expect(h.set).toHaveBeenCalledWith('__Secure-neon-auth.session_token', '', expect.objectContaining({ maxAge: 0, httpOnly: true, path: '/' }));
    const reads = fetchMock.mock.calls.filter(([url]) => String(url).includes('disableCookieCache=true'));
    expect(reads).toHaveLength(1);
  });
  it('requires only managed-auth configuration and never falls back to an application SQL URL', () => {
    vi.stubEnv('NEON_AUTH_URL', '');
    expect(() => getAuth()).toThrow('configuración');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(local.calls).toEqual([]);
  });
});
