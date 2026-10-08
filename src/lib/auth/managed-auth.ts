import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { club, profileWeapon, userProfile } from '@/db/schema';
import { AHORA_SQL } from '@/lib/sqlite';
import { correoVerificado, esRolAplicacion } from './access-policy';
import { authOtpChallenge } from './cloudflare-schema';
import { ErrorAcceso } from './errores';
import { COOKIE_ACCESO_QA } from './qa-token';
import { COOKIE_VISTA_PREVIA } from './preview-token';
import { allowOtpRequest, privateAuthKey, type AuthDatabase } from './rate-limit';
import type { SessionCache } from './session-cache';

const SEND = 'email-otp/send-verification-otp';
const VERIFY = 'sign-in/email-otp';
const PRIVATE = { 'Cache-Control': 'private, no-store' };
const SECURE_SESSION_COOKIE = '__Secure-neon-auth.session_token';
const LOCAL_SESSION_COOKIE = 'neon-auth.session_token';
const SECURE_NEON_COOKIES = new Set([SECURE_SESSION_COOKIE, '__Secure-neon-auth.local.session_data']);
// Plain names only exist on http://localhost, where browsers refuse `__Secure-`.
const LOCAL_NEON_COOKIES = new Set([LOCAL_SESSION_COOKIE, 'neon-auth.local.session_data']);
const DENIED = { code: 'ACCESO_NO_PERMITIDO', message: 'No se ha podido entrar. Pide un código nuevo.' };
const LIMITED = { code: 'DEMASIADOS_CODIGOS', message: 'Has pedido demasiados códigos. Prueba en unos minutos.' };
const WEAPONS = new Set(['FLORETE', 'ESPADA', 'SABLE'] as const);

type Identity = { id: string; email: string; emailVerified: true };
export type ProviderSession = { user: Identity; session: { id: string; expiresAt: string } };
type Weapon = 'FLORETE' | 'ESPADA' | 'SABLE';
/** The D1 profile that authorized the session. Server-side only: never serialized by `handler`. */
export type ManagedProfile = {
  id: string;
  authUserId: string;
  email: string;
  fullName: string;
  role: 'admin' | 'coach' | 'athlete';
  inviteStatus: typeof userProfile.$inferSelect.inviteStatus;
  clubId: string | null;
  clubName: string | null;
  icalToken: string;
  /** Only read for coaches; empty for everyone else. */
  weapons: Weapon[];
};
type Session = ProviderSession & { profile: ManagedProfile };
type ApiInput = { headers: Headers; body?: { email?: string; otp?: string; type?: string } };
export type ManagedAuthConfig = {
  secret: string;
  origin: string;
  request: (request: Request, path: string) => Promise<Response>;
  writeCookies?: (response: Response) => Promise<void>;
  /** Defaults to true for an https origin: plain `neon-auth.*` cookies are then ignored. */
  secureCookiesOnly?: boolean;
  /** Daily ceiling of codes sent to invited addresses. See `otpDailyLimit`. */
  otpDailyLimit?: number;
  /** Short-lived memory of validated provider sessions, shared across requests. See `session-cache.ts`. */
  sessionCache?: SessionCache<ProviderSession>;
};

function deny(status = 403) {
  return Response.json(DENIED, { status, headers: PRIVATE });
}

/** Every session cookie the provider would read, exactly as sent; null when there is none. */
function sessionCookies(headers: Headers, secureOnly: boolean): string | null {
  const found = (headers.get('cookie') ?? '').split(';').map((c) => c.trim()).filter((c) => {
    const name = c.split('=', 1)[0].trim();
    const value = c.slice(c.indexOf('=') + 1).trim();
    return c.includes('=') && value !== '' &&
      (name === SECURE_SESSION_COOKIE || (!secureOnly && name === LOCAL_SESSION_COOKIE));
  });
  return found.length > 0 ? found.join('; ') : null;
}

function identity(value: unknown): Identity | null {
  if (!value || typeof value !== 'object') return null;
  const user = value as Partial<Identity>;
  if (typeof user.id !== 'string' || !user.id || user.id.length > 200 ||
      typeof user.email !== 'string' || !correoVerificado(user)) return null;
  const email = user.email.trim().toLowerCase();
  return z.email().max(254).safeParse(email).success ? { id: user.id, email, emailVerified: true } : null;
}

function allowedCookie(name: string, secureOnly: boolean) {
  return SECURE_NEON_COOKIES.has(name) || (!secureOnly && LOCAL_NEON_COOKIES.has(name));
}

function withCookies(data: unknown, source: Response, secureOnly: boolean) {
  const response = Response.json(data, { headers: PRIVATE });
  for (const cookie of source.headers.getSetCookie()) {
    if (allowedCookie(cookie.split('=', 1)[0].trim(), secureOnly)) response.headers.append('Set-Cookie', cookie);
  }
  return response;
}

/**
 * Over https only the `__Secure-` names reach the provider: browsers only
 * accept them from a Secure response, so a plain-http injection cannot plant
 * one. This does NOT stop a sibling Worker under the same account subdomain
 * of workers.dev (same site) from setting one with `Domain=`; only a custom
 * domain or `__Host-` cookies would.
 */
function providerHeaders(headers: Headers, secureOnly: boolean): Headers {
  const cookie = headers.get('cookie');
  if (!secureOnly || !cookie) return headers;
  const kept = cookie.split(';').map((c) => c.trim())
    .filter((c) => c && !LOCAL_NEON_COOKIES.has(c.split('=', 1)[0].trim()));
  const copy = new Headers(headers);
  if (kept.length > 0) copy.set('cookie', kept.join('; '));
  else copy.delete('cookie');
  return copy;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } finally {
    reader.releaseLock();
  }
}

/** Managed authentication uses its API only. Profiles and limits stay in D1. */
export function createManagedAuth(db: AuthDatabase, config: ManagedAuthConfig) {
  if (config.secret.length < 32) throw new Error('Falta NEON_AUTH_COOKIE_SECRET (mínimo 32 caracteres).');
  const origin = new URL(config.origin).origin;
  const secureOnly = config.secureCookiesOnly ?? origin.startsWith('https:');
  const challengeKey = (email: string) => privateAuthKey(config.secret, 'managed-otp', email);

  async function invitation(email: string, userId?: string) {
    const rows = await db.select({
      id: userProfile.id, authUserId: userProfile.authUserId,
      inviteStatus: userProfile.inviteStatus, role: userProfile.role,
    }).from(userProfile).where(sql`lower(trim(${userProfile.email})) = ${email}`).limit(2);
    const row = rows.length === 1 ? rows[0] : null;
    if (!row || row.inviteStatus === 'revocada' || !esRolAplicacion(row.role)) return null;
    // Imported IDs still belong to the SAME managed provider. Never replace one.
    if (userId && row.authUserId !== null && row.authUserId !== userId) return null;
    return row;
  }

  /**
   * Same rules as `invitation` (one normalized match, live, application role,
   * same managed identity) plus everything the app needs about the person, in
   * ONE indexed read: club name by join and, only for coaches, their weapons.
   */
  async function sessionProfile(user: Identity): Promise<ManagedProfile | null> {
    const rows = await db.select({
      id: userProfile.id, authUserId: userProfile.authUserId, email: userProfile.email,
      fullName: userProfile.fullName, role: userProfile.role, inviteStatus: userProfile.inviteStatus,
      clubId: userProfile.clubId, clubName: club.name, icalToken: userProfile.icalToken,
      weapons: sql<string | null>`CASE WHEN ${userProfile.role} = 'coach' THEN
        (SELECT group_concat(${profileWeapon.weapon}) FROM ${profileWeapon}
          WHERE ${profileWeapon.profileId} = ${userProfile.id}) END`,
    }).from(userProfile).leftJoin(club, eq(userProfile.clubId, club.id))
      .where(sql`lower(trim(${userProfile.email})) = ${user.email}`).limit(2);
    const row = rows.length === 1 ? rows[0] : null;
    if (!row || row.inviteStatus === 'revocada' || !esRolAplicacion(row.role) ||
        row.authUserId !== user.id || row.email.trim().toLowerCase() !== user.email) return null;
    const weapons = (row.weapons ?? '').split(',').filter((w): w is Weapon => WEAPONS.has(w as Weapon));
    return {
      id: row.id, authUserId: row.authUserId, email: row.email, fullName: row.fullName, role: row.role,
      inviteStatus: row.inviteStatus, clubId: row.clubId, clubName: row.clubName, icalToken: row.icalToken, weapons,
    };
  }

  async function providerSession(headers: Headers): Promise<{ value: ProviderSession; expiresAt: number } | null> {
    const url = new URL('/api/auth/get-session', origin);
    // Bypass both the SDK's local cookie cache and the upstream cookie cache.
    url.searchParams.set('disableCookieCache', 'true');
    const result = await config.request(new Request(url, { headers }), 'get-session');
    if (!result.ok) throw new Error('AUTH_PROVIDER_UNAVAILABLE');
    const body = await result.json() as { user?: unknown; session?: { id?: unknown; expiresAt?: unknown } } | null;
    const user = identity(body?.user);
    if (!user) return null;
    const expiresAt = typeof body?.session?.expiresAt === 'string' ? body.session.expiresAt : '';
    const expires = Date.parse(expiresAt);
    if (typeof body?.session?.id !== 'string' || !Number.isFinite(expires) || expires <= Date.now()) return null;
    return { value: { user, session: { id: body.session.id, expiresAt } }, expiresAt: expires };
  }

  const cacheKey = (cookies: string) => privateAuthKey(config.secret, 'session-cache', cookies);

  async function session(headers: Headers): Promise<Session | null> {
    // No session cookie: nothing the provider could validate, so no round trip.
    const cookies = sessionCookies(headers, secureOnly);
    if (!cookies) return null;
    const provider = config.sessionCache
      ? await config.sessionCache.read(cacheKey(cookies), () => providerSession(headers))
      : (await providerSession(headers))?.value ?? null;
    if (!provider || Date.parse(provider.session.expiresAt) <= Date.now()) return null;
    // Never cached: invitation, revocation and role apply on the very next request.
    const profile = await sessionProfile(provider.user);
    return profile ? { ...provider, profile } : null;
  }

  function evictSession(headers: Headers) {
    const cookies = sessionCookies(headers, secureOnly);
    if (cookies) config.sessionCache?.evict(cacheKey(cookies));
  }

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/auth\//, '');
    const names = new Set((request.headers.get('cookie') ?? '').split(';').map((c) => c.trim().split('=')[0]));
    if (url.origin !== origin || names.has(COOKIE_ACCESO_QA)) return deny();
    const forwarded = providerHeaders(request.headers, secureOnly);
    if (request.method === 'GET') {
      if (path !== 'get-session') return deny(404);
      try {
        const current = await session(forwarded);
        return Response.json(current ? { user: current.user, session: current.session } : null, { headers: PRIVATE });
      } catch { return deny(503); }
    }
    if (request.method !== 'POST' || ![SEND, VERIFY, 'sign-out'].includes(path)) return deny();
    if (names.has(COOKIE_VISTA_PREVIA) && path !== 'sign-out') return deny();
    if (request.headers.get('origin') !== origin) return deny();
    if (!request.headers.get('content-type')?.startsWith('application/json')) return deny(415);

    try {
      const body = await readBody(request);
      if (!body) return deny(400);
      if (path === 'sign-out') {
        // Before anything else: even a failed sign-out must not leave this session remembered.
        evictSession(forwarded);
        const response = await config.request(new Request(url, {
          method: 'POST', headers: forwarded, body: '{}',
        }), path);
        if (!response.ok || (await response.clone().json())?.success !== true) return deny(503);
        // Confirm revocation using the ORIGINAL cookie, not the new deletion cookie.
        const checkUrl = new URL('/api/auth/get-session?disableCookieCache=true', origin);
        const check = await config.request(new Request(checkUrl, { headers: forwarded }), 'get-session');
        if (!check.ok) return deny(503);
        const remaining = await check.json() as { session?: unknown; user?: unknown } | null;
        if (remaining?.session || remaining?.user) return deny(503);
        // A read that started before the provider revoked the session may have stored it meanwhile.
        evictSession(forwarded);
        return withCookies({ success: true }, response, secureOnly);
      }

      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!z.email().max(254).safeParse(email).success) return deny(400);
      const send = path === SEND;
      if (send && body.type !== 'sign-in') return deny();
      if (!send && (typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp))) return deny(400);
      // The invitation is read first so that invented addresses never touch the
      // per-address counters or the global daily quota.
      const profile = await invitation(email);
      const decision = await allowOtpRequest(db, config.secret, email, request.headers, send, {
        invited: profile !== null,
        ...(config.otpDailyLimit ? { dailyLimit: config.otpDailyLimit } : {}),
      });
      // `limitado` never depends on whether the address is invited (see `OtpDecision`).
      if (send && decision === 'limitado') return Response.json(LIMITED, { status: 429, headers: PRIVATE });
      if (decision !== 'permitido' || !profile) return send ? Response.json({ success: true }, { headers: PRIVATE }) : deny(400);
      const key = challengeKey(email);

      if (send) {
        const generation = crypto.randomUUID();
        const now = Date.now();
        await db.insert(authOtpChallenge).values({
          key, generation, attempts: 0, ready: false, expiresAt: now + 5 * 60_000,
        }).onConflictDoUpdate({
          target: authOtpChallenge.key,
          set: { generation, attempts: 0, ready: false, expiresAt: now + 5 * 60_000 },
        });
        const response = await config.request(new Request(url, {
          method: 'POST', headers: forwarded, body: JSON.stringify({ email, type: 'sign-in' }),
        }), path);
        if (response.ok) await db.update(authOtpChallenge).set({ ready: true })
          .where(and(eq(authOtpChallenge.key, key), eq(authOtpChallenge.generation, generation)));
        return Response.json({ success: true }, { headers: PRIVATE });
      }

      // A durable CAS limits each app-issued challenge to three processed attempts.
      const [challenge] = await db.update(authOtpChallenge)
        .set({ attempts: sql`${authOtpChallenge.attempts} + 1` })
        .where(and(
          eq(authOtpChallenge.key, key), eq(authOtpChallenge.ready, true),
          sql`${authOtpChallenge.expiresAt} > ${Date.now()}`, sql`${authOtpChallenge.attempts} < 3`,
        )).returning({ generation: authOtpChallenge.generation });
      if (!challenge) return deny(400);
      const response = await config.request(new Request(url, {
        method: 'POST', headers: forwarded, body: JSON.stringify({ email, otp: body.otp }),
      }), path);
      if (!response.ok) return deny(400);
      const result = await response.clone().json() as { user?: unknown } | null;
      const user = identity(result?.user);
      const sessionCookie = secureOnly
        ? /^__Secure-neon-auth\.session_token=[^;]+/
        : /^(?:__Secure-)?neon-auth\.session_token=[^;]+/;
      if (!user || user.email !== email || !response.headers.getSetCookie().some((cookie) =>
        sessionCookie.test(cookie),
      )) return deny(400);

      // Only a freshly verified OTP can claim an unlinked invitation. Recheck
      // revocation, uniqueness, the current challenge and the existing ID in SQL.
      const [linked] = await db.update(userProfile)
        .set({ authUserId: user.id, inviteStatus: 'aceptada', updatedAt: new Date() })
        .where(and(
          eq(userProfile.id, profile.id), ne(userProfile.inviteStatus, 'revocada'),
          sql`${userProfile.role} IN ('admin', 'coach', 'athlete')`,
          sql`lower(trim(${userProfile.email})) = ${email}`,
          or(isNull(userProfile.authUserId), eq(userProfile.authUserId, user.id)),
          sql`(SELECT count(*) FROM user_profile p WHERE lower(trim(p.email)) = ${email}) = 1`,
          sql`NOT EXISTS (SELECT 1 FROM user_profile p WHERE p.auth_user_id = ${user.id} AND p.id != ${profile.id})`,
          sql`EXISTS (SELECT 1 FROM auth_otp_challenge c WHERE c.key = ${key}
            AND c.generation = ${challenge.generation} AND c.ready = 1 AND c.expires_at > ${AHORA_SQL})`,
        )).returning({ id: userProfile.id });
      if (!linked) return deny(400);
      await db.delete(authOtpChallenge).where(and(
        eq(authOtpChallenge.key, key), eq(authOtpChallenge.generation, challenge.generation),
      ));
      return withCookies({ user }, response, secureOnly);
    } catch {
      // Never propagate SQL parameters, provider errors, identities, OTPs or cookies.
      return path === SEND ? Response.json({ success: true }, { headers: PRIVATE }) : deny(503);
    }
  }

  async function invoke(path: string, input: ApiInput) {
    const headers = new Headers(input.headers);
    headers.set('content-type', 'application/json');
    const response = await handler(new Request(new URL(`/api/auth/${path}`, origin), {
      method: 'POST', headers, body: JSON.stringify(input.body ?? {}),
    }));
    if (!response.ok) throw new ErrorAcceso(response.status);
    if (path !== SEND) await config.writeCookies?.(response);
    return response.json();
  }

  /** In process, so the D1 profile travels with the session instead of being read twice. */
  async function getSession(input: ApiInput): Promise<Session | null> {
    const names = new Set((input.headers.get('cookie') ?? '').split(';').map((c) => c.trim().split('=')[0]));
    if (names.has(COOKIE_ACCESO_QA)) throw new ErrorAcceso(403);
    try { return await session(providerHeaders(input.headers, secureOnly)); }
    catch { throw new ErrorAcceso(503); }
  }

  return {
    handler,
    api: {
      getSession,
      sendVerificationOTP: (input: ApiInput): Promise<{ success: true }> => invoke(SEND, input),
      signInEmailOTP: (input: ApiInput): Promise<{ user: Identity }> => invoke(VERIFY, input),
      signOut: (input: ApiInput): Promise<{ success: true }> => invoke('sign-out', input),
    },
  };
}
