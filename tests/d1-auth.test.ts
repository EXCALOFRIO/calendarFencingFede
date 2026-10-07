import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManagedAuth } from '@/lib/auth/managed-auth';
import {
  allowOtpRequest, OTP_DAILY_LIMIT_DEFAULT, otpDailyLimit, privateAuthKey, takeAuthLimit,
} from '@/lib/auth/rate-limit';
import { localAuthDatabase } from './d1-auth-local';

const ORIGIN = 'https://auth.example.test';
const EMAIL = 'invited@example.test';
const SECRET = 'only-a-local-test-key-at-least-thirty-two-characters';
const SEND = 'email-otp/send-verification-otp';
const VERIFY = 'sign-in/email-otp';
let local: ReturnType<typeof localAuthDatabase>;
let auth: ReturnType<typeof createManagedAuth>;
let provider: ReturnType<typeof vi.fn>;
let writeCookies: ReturnType<typeof vi.fn>;
let verified: boolean;
let issued: boolean;
let otpUsed: boolean;
let userId: string;
let wrongUser: string;
let failSend: boolean;
let failLogout: boolean;
let active: boolean;

function createAuth() {
  return createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider, writeCookies });
}
function invite(email = EMAIL, authUserId: string | null = null, role = 'athlete', status = 'pendiente') {
  local.sqlite.prepare(`INSERT INTO user_profile
    (id,email,auth_user_id,full_name,role,invite_status,updated_at,ical_token)
    VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), email, authUserId, 'Invited test profile', role, status, Date.now(), crypto.randomUUID());
}
function request(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/auth/${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers },
    body: JSON.stringify(body),
  });
}
function post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return auth.handler(request(path, body, headers));
}
function send(email = EMAIL) { return post(SEND, { email, type: 'sign-in' }); }
function redeem(otp = '123456', email = EMAIL) { return post(VERIFY, { email, otp }); }
function cookie(response: Response) {
  return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
function providerIdentity() {
  return { id: userId, email: wrongUser || EMAIL, emailVerified: verified };
}

beforeEach(() => {
  for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  local = localAuthDatabase();
  verified = true; issued = false; otpUsed = false; userId = 'neon-test-identity';
  wrongUser = ''; failSend = false; failLogout = false; active = false;
  writeCookies = vi.fn(async () => {});
  provider = vi.fn(async (req: Request, path: string) => {
    if (path === 'get-session') return Response.json(active ? {
      user: providerIdentity(), session: { id: 'synthetic-session', expiresAt: new Date(Date.now() + 60_000).toISOString(), token: 'never-forward' },
    } : null);
    if (path === 'sign-out') {
      if (failLogout) return Response.json({ message: 'synthetic-provider-private-parameters' }, { status: 500 });
      active = false;
      return Response.json({ success: true }, { headers: { 'set-cookie': '__Secure-neon-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure' } });
    }
    const body = await req.clone().json();
    if (path === SEND) {
      if (failSend) throw new Error('synthetic-provider-private-parameters');
      issued = true; otpUsed = false;
      return Response.json({ success: true });
    }
    if (path === VERIFY && issued && !otpUsed && body.otp === '123456') {
      otpUsed = true; active = true;
      const response = Response.json({ user: providerIdentity(), token: 'never-forward' });
      response.headers.append('set-cookie', '__Secure-neon-auth.session_token=synthetic-token; Path=/; HttpOnly; Secure; SameSite=Lax');
      response.headers.append('set-cookie', 'unrelated-cookie=must-not-forward; Path=/');
      return response;
    }
    return Response.json({ code: 'private-provider-error' }, { status: 400 });
  });
  auth = createAuth();
});
afterEach(() => {
  local.sqlite.close();
  try {
    for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) expect(console[method]).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); }
});

describe('managed Neon Auth with native SQLite application authorization', () => {
  it('does not persist a managed identity, session or OTP; binds only after verification', async () => {
    invite(' Invited@Example.test ');
    expect((await send()).status).toBe(200);
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile').get()!.auth_user_id).toBeNull();
    const response = await redeem();
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ user: { id: userId, email: EMAIL, emailVerified: true } });
    expect(local.sqlite.prepare('SELECT auth_user_id,invite_status FROM user_profile').get())
      .toMatchObject({ auth_user_id: userId, invite_status: 'aceptada' });
    const tables = local.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'auth_%'").all().map((r) => r.name);
    expect(tables.sort()).toEqual(['auth_otp_challenge', 'auth_throttle']);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toContain('HttpOnly; Secure');
    expect(cookie(response)).not.toContain('unrelated-cookie');
  });

  it('preserves the managed identity reference instead of replacing an existing link', async () => {
    invite(EMAIL, 'other-neon-identity');
    await send();
    const response = await redeem();
    expect(response.ok).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile').get()!.auth_user_id).toBe('other-neon-identity');
  });

  it('an existing matching managed identity can sign in without changing its role', async () => {
    invite(EMAIL, userId, 'admin', 'aceptada');
    await send();
    expect((await redeem()).ok).toBe(true);
    expect(local.sqlite.prepare('SELECT role,auth_user_id FROM user_profile').get()).toMatchObject({ role: 'admin', auth_user_id: userId });
  });

  it.each(['unknown', 'revoked', 'club', 'guardian'])('does not disclose or contact the provider for %s', async (kind) => {
    if (kind !== 'unknown') invite(EMAIL, null, kind === 'revoked' ? 'athlete' : kind, kind === 'revoked' ? 'revocada' : 'pendiente');
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect((await redeem()).ok).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['admin', 'coach', 'athlete'])('preserves the invited %s role', async (role) => {
    invite(EMAIL, null, role); await send();
    expect((await redeem()).ok).toBe(true);
    expect(local.sqlite.prepare('SELECT role FROM user_profile').get()!.role).toBe(role);
  });

  it.each(['sign-up/email', 'sign-in/email', 'reset-password', 'change-email', 'email-otp/check-verification-otp', 'email-otp/verify-email'])(
    'blocks direct %s before contacting Neon', async (path) => {
      invite();
      expect((await post(path, { email: EMAIL, password: 'not-a-real-password', otp: '123456' })).ok).toBe(false);
      expect(provider).not.toHaveBeenCalled();
    },
  );

  it('exposes no arbitrary signup, password or OTP-disclosure server API', () => {
    expect(Object.keys(auth.api).sort()).toEqual(['getSession', 'sendVerificationOTP', 'signInEmailOTP', 'signOut']);
  });
  it.each(['', 'https://external.example.test'])('rejects missing/foreign Origin %s before email delivery', async (origin) => {
    invite(); expect((await post(SEND, { email: EMAIL, type: 'sign-in' }, { origin })).ok).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each(['email-verification', 'forget-password', 'change-email'])('refuses OTP type %s', async (type) => {
    invite(); expect((await post(SEND, { email: EMAIL, type })).ok).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([false, undefined])('does not forward cookies or link an unverified managed user: %s', async (value) => {
    invite(); await send(); verified = value as boolean;
    const response = await redeem();
    expect(response.ok).toBe(false); expect(response.headers.has('set-cookie')).toBe(false);
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile').get()!.auth_user_id).toBeNull();
  });
  it('rejects a verified identity returned for a different email', async () => {
    invite(); await send(); wrongUser = 'other@example.test';
    expect((await redeem()).ok).toBe(false);
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile').get()!.auth_user_id).toBeNull();
  });
  it('fails closed for ambiguous normalized imported invitations', async () => {
    invite(); invite('INVITED@example.test'); await send();
    expect(provider).not.toHaveBeenCalled(); expect((await redeem()).ok).toBe(false);
  });
  it('revocation between sending and redemption denies provider verification', async () => {
    invite(); await send(); provider.mockClear();
    local.sqlite.prepare("UPDATE user_profile SET invite_status='revocada'").run();
    expect((await redeem()).ok).toBe(false); expect(provider).not.toHaveBeenCalled();
  });
  it('an atomic profile CAS denies revocation racing a successful provider response', async () => {
    invite(); await send();
    local.state.beforeQuery = (query) => {
      if (!query.startsWith('update "user_profile"')) return;
      local.state.beforeQuery = () => {};
      local.sqlite.prepare("UPDATE user_profile SET invite_status='revocada'").run();
    };
    const response = await redeem();
    expect(response.ok).toBe(false); expect(response.headers.has('set-cookie')).toBe(false);
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile').get()!.auth_user_id).toBeNull();
  });
  it.each([
    "UPDATE user_profile SET role='club'", "UPDATE user_profile SET role='guardian'",
    'UPDATE user_profile SET auth_user_id=NULL', "UPDATE user_profile SET email='changed@example.test'",
    "UPDATE user_profile SET invite_status='revocada'", 'DELETE FROM user_profile',
  ])('a managed session loses app authorization on the next request: %s', async (change) => {
    invite(); await send(); const response = await redeem();
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookie(response) }) })).not.toBeNull();
    local.sqlite.exec(change);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookie(response) }) })).toBeNull();
  });
  it('ordinary get-session never claims an unlinked invitation and bypasses cookie caches', async () => {
    invite(); active = true;
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
    const req = provider.mock.calls[0][0] as Request;
    expect(new URL(req.url).searchParams.get('disableCookieCache')).toBe('true');
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile').get()!.auth_user_id).toBeNull();
  });
  it('provider errors and delivery failures cannot disclose private data or create a ready challenge', async () => {
    invite(); failSend = true;
    const response = await send();
    expect(await response.json()).toEqual({ success: true });
    expect((await redeem()).ok).toBe(false);
    expect(local.sqlite.prepare('SELECT ready FROM auth_otp_challenge').get()!.ready).toBe(0);
  });
  it('SQL failures while binding cannot set session cookies or leak SQL parameters', async () => {
    invite(); await send();
    local.state.beforeQuery = (query) => { if (query.startsWith('update "user_profile"')) throw new Error('synthetic-provider-private-parameters'); };
    const response = await redeem();
    expect(response.ok).toBe(false); expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.json()).toMatchObject({ code: 'ACCESO_NO_PERMITIDO' });
  });
  it('strips caller-supplied user fields before proxying verification', async () => {
    invite(); await send();
    const response = await post(VERIFY, { email: EMAIL, otp: '123456', name: 'attacker', role: 'admin', emailVerified: true });
    expect(response.ok).toBe(true);
    expect(await (provider.mock.calls.at(-1)![0] as Request).clone().json()).toEqual({ email: EMAIL, otp: '123456' });
  });
});

describe('bounded, persistent and privacy-safe app-side OTP controls', () => {
  it('only one redemption wins across independent app instances', async () => {
    invite(); await send();
    const results = await Promise.all([redeem(), createAuth().handler(request(VERIFY, { email: EMAIL, otp: '123456' }))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await redeem()).ok).toBe(false);
  });
  it('three wrong attempts exhaust the challenge across independent app instances', async () => {
    invite(); await send();
    for (let i = 0; i < 3; i++) expect((await createAuth().handler(request(VERIFY, { email: EMAIL, otp: '000000' }))).ok).toBe(false);
    expect((await redeem()).ok).toBe(false);
    expect(provider.mock.calls.filter(([, path]) => path === VERIFY)).toHaveLength(3);
  });
  it('expires the app challenge after five minutes', async () => {
    invite(); await send();
    const expires = Number(local.sqlite.prepare('SELECT expires_at FROM auth_otp_challenge').get()!.expires_at);
    expect(expires).toBeGreaterThan(Date.now() + 299_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 300_000);
    local.sqlite.prepare('UPDATE auth_otp_challenge SET expires_at=?').run(Date.now() - 1);
    expect((await redeem()).ok).toBe(false);
  });
  it('cannot resend within a minute; hashes and limits survive isolate replacement', async () => {
    invite(); await send(); await send();
    await createAuth().handler(request(SEND, { email: EMAIL, type: 'sign-in' }));
    expect(provider.mock.calls.filter(([, path]) => path === SEND)).toHaveLength(1);
    for (const row of local.sqlite.prepare('SELECT key FROM auth_throttle UNION SELECT key FROM auth_otp_challenge').all()) {
      expect(row.key).toMatch(/^[0-9a-f]{64}$/);
      expect(row.key).not.toContain(EMAIL); expect(row.key).not.toContain('192.0.2.1');
    }
  });
  it('a permitted resend rotates the challenge generation and resets processed attempts', async () => {
    invite(); await send(); await redeem('000000');
    const old = local.sqlite.prepare('SELECT generation FROM auth_otp_challenge').get()!.generation;
    local.sqlite.prepare('UPDATE auth_throttle SET window_start=? WHERE key=?')
      .run(Date.now() - 61_000, privateAuthKey(SECRET, 'send-delay', EMAIL));
    await send();
    const row = local.sqlite.prepare('SELECT generation,attempts,ready FROM auth_otp_challenge').get()!;
    expect(row.generation).not.toBe(old); expect(row.attempts).toBe(0); expect(row.ready).toBe(1);
  });
  it('a newer generation cannot be consumed by an old in-flight redemption', async () => {
    invite(); await send();
    provider.mockImplementationOnce(async () => {
      local.sqlite.prepare("UPDATE auth_otp_challenge SET generation='new-generation'").run();
      return Response.json({ user: providerIdentity() }, { headers: { 'set-cookie': '__Secure-neon-auth.session_token=synthetic-token; Path=/; HttpOnly; Secure' } });
    });
    const response = await redeem();
    expect(response.ok).toBe(false); expect(response.headers.has('set-cookie')).toBe(false);
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile').get()!.auth_user_id).toBeNull();
  });
  it('atomic counters cannot be bypassed by parallel requests or forwarded IP aliases', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => takeAuthLimit(local.db, SECRET, 'atomic', EMAIL, 3, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(3);
    const headers = new Headers({ 'cf-connecting-ip': '192.0.2.2', 'x-forwarded-for': '198.51.100.1' });
    for (let i = 0; i < 5; i++) expect(await allowOtpRequest(local.db, SECRET, `email${i}@example.test`, headers, true, { invited: true })).toBe(true);
    headers.set('x-forwarded-for', '198.51.100.2');
    expect(await allowOtpRequest(local.db, SECRET, 'next@example.test', headers, true, { invited: true })).toBe(false);
  });
  it('invented addresses never write per-address rows nor spend the global daily quota', async () => {
    auth = createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider, writeCookies, otpDailyLimit: 1 });
    for (let i = 0; i < 30; i++) {
      const response = await auth.handler(request(SEND, { email: `invented${i}@example.test`, type: 'sign-in' }, { 'cf-connecting-ip': `198.51.100.${i}` }));
      expect(await response.json()).toEqual({ success: true });
    }
    expect(provider).not.toHaveBeenCalled();
    const keys = new Set(local.sqlite.prepare('SELECT key FROM auth_throttle').all().map((r) => r.key));
    expect(keys.has(privateAuthKey(SECRET, 'send-global-day', 'all'))).toBe(false);
    expect(keys.has(privateAuthKey(SECRET, 'send-email-hour', 'invented0@example.test'))).toBe(false);
    invite();
    expect((await send()).ok).toBe(true);
    expect(provider.mock.calls.filter(([, path]) => path === SEND)).toHaveLength(1);
  });
  it('only sends to invited addresses count against the configurable daily quota', async () => {
    auth = createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider, writeCookies, otpDailyLimit: 1 });
    invite(); invite('second@example.test');
    await send();
    await auth.handler(request(SEND, { email: 'second@example.test', type: 'sign-in' }, { 'cf-connecting-ip': '192.0.2.9' }));
    expect(provider.mock.calls.filter(([, path]) => path === SEND)).toHaveLength(1);
  });
  it.each([
    [undefined, 2000], ['', 2000], ['abc', 2000], ['0', 2000], ['-5', 2000], ['5000', 5000],
  ])('AUTH_OTP_DAILY_LIMIT=%s gives a daily quota of %d', (value, expected) => {
    expect(otpDailyLimit(value)).toBe(expected);
    expect(OTP_DAILY_LIMIT_DEFAULT).toBe(2000);
  });
  it('a rate window resets exactly at the boundary', async () => {
    expect(await takeAuthLimit(local.db, SECRET, 'boundary', EMAIL, 1, 60_000, 100_000)).toBe(true);
    expect(await takeAuthLimit(local.db, SECRET, 'boundary', EMAIL, 1, 60_000, 159_999)).toBe(false);
    expect(await takeAuthLimit(local.db, SECRET, 'boundary', EMAIL, 1, 60_000, 160_000)).toBe(true);
  });
  it.each(['calendario_vista_previa', 'calendario_acceso_qa'])('read-only cookie %s cannot change identity', async (name) => {
    invite();
    for (const path of [SEND, VERIFY]) expect((await post(path, { email: EMAIL, type: 'sign-in', otp: '123456' }, { cookie: `${name}=invalid` })).ok).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
  it('logout confirms upstream revocation before forwarding deletion cookies', async () => {
    invite(); await send(); const response = await redeem();
    const value = cookie(response);
    expect((await post('sign-out', {}, { cookie: value })).ok).toBe(true);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: value }) })).toBeNull();
    expect(provider.mock.calls.at(-2)![1]).toBe('get-session');
  });
  it.each(['http', 'server-api'])('failed managed logout never discards cookies or claims success: %s', async (mode) => {
    invite(); await send(); const response = await redeem(); failLogout = true;
    const headers = new Headers({ origin: ORIGIN, cookie: cookie(response) });
    if (mode === 'http') {
      const failed = await post('sign-out', {}, Object.fromEntries(headers));
      expect(failed.ok).toBe(false); expect(failed.headers.has('set-cookie')).toBe(false);
    } else await expect(auth.api.signOut({ headers })).rejects.toThrow('ACCESO_NO_PERMITIDO');
    expect(active).toBe(true); expect(writeCookies).not.toHaveBeenCalled();
  });
  it('does not claim logout if the provider returns success without revoking the original cookie', async () => {
    active = true;
    provider.mockImplementationOnce(async () => Response.json({ success: true }));
    const result = await post('sign-out', {}, { cookie: '__Secure-neon-auth.session_token=synthetic-token' });
    expect(result.ok).toBe(false); expect(result.headers.has('set-cookie')).toBe(false);
  });
  it('over https only __Secure- managed cookies reach the provider or the browser', async () => {
    invite(); await send(); const response = await redeem();
    expect(response.ok).toBe(true);
    provider.mockClear();
    await auth.api.getSession({ headers: new Headers({
      cookie: 'neon-auth.session_token=planted; __Secure-neon-auth.session_token=synthetic-token; other=1',
    }) });
    const forwarded = (provider.mock.calls[0][0] as Request).headers.get('cookie');
    expect(forwarded).toBe('__Secure-neon-auth.session_token=synthetic-token; other=1');
  });
  it('over https a plain session cookie from the provider is neither accepted nor forwarded', async () => {
    invite(); await send();
    provider.mockImplementationOnce(async () => {
      active = true;
      return Response.json({ user: providerIdentity() }, { headers: { 'set-cookie': 'neon-auth.session_token=plain; Path=/; HttpOnly' } });
    });
    const response = await redeem();
    expect(response.ok).toBe(false); expect(response.headers.has('set-cookie')).toBe(false);
  });
  it('plain http (local development and tests) keeps the unprefixed cookies', async () => {
    const local8787 = 'http://localhost:8787';
    auth = createManagedAuth(local.db, { secret: SECRET, origin: local8787, request: provider, writeCookies });
    await auth.api.getSession({ headers: new Headers({ cookie: 'neon-auth.session_token=dev' }) });
    expect((provider.mock.calls[0][0] as Request).headers.get('cookie')).toBe('neon-auth.session_token=dev');
  });
  it('server actions use the same guards and apply cookies only after successful authorization', async () => {
    invite();
    const headers = new Headers({ origin: ORIGIN, 'cf-connecting-ip': '192.0.2.1' });
    await auth.api.sendVerificationOTP({ headers, body: { email: EMAIL, type: 'sign-in' } });
    await expect(auth.api.signInEmailOTP({ headers, body: { email: EMAIL, otp: '000000' } })).rejects.toThrow();
    expect(writeCookies).not.toHaveBeenCalled();
    await auth.api.signInEmailOTP({ headers, body: { email: EMAIL, otp: '123456' } });
    expect(writeCookies).toHaveBeenCalledTimes(1);
  });
});
