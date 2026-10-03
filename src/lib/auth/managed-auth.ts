import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { userProfile } from '@/db/schema';
import { AHORA_SQL } from '@/lib/sqlite';
import { correoVerificado, esRolAplicacion } from './access-policy';
import { authOtpChallenge } from './cloudflare-schema';
import { COOKIE_ACCESO_QA } from './qa-token';
import { COOKIE_VISTA_PREVIA } from './preview-token';
import { allowOtpRequest, privateAuthKey, type AuthDatabase } from './rate-limit';

const SEND = 'email-otp/send-verification-otp';
const VERIFY = 'sign-in/email-otp';
const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NEON_COOKIES = new Set([
  '__Secure-neon-auth.session_token', 'neon-auth.session_token',
  '__Secure-neon-auth.local.session_data', 'neon-auth.local.session_data',
]);
const DENIED = { code: 'ACCESO_NO_PERMITIDO', message: 'No se ha podido entrar. Pide un código nuevo.' };

type Identity = { id: string; email: string; emailVerified: true };
type Session = { user: Identity; session: { id: string; expiresAt: string } };
type ApiInput = { headers: Headers; body?: { email?: string; otp?: string; type?: string } };
export type ManagedAuthConfig = {
  secret: string;
  origin: string;
  request: (request: Request, path: string) => Promise<Response>;
  writeCookies?: (response: Response) => Promise<void>;
};

function deny(status = 403) {
  return Response.json(DENIED, { status, headers: PRIVATE });
}

function identity(value: unknown): Identity | null {
  if (!value || typeof value !== 'object') return null;
  const user = value as Partial<Identity>;
  if (typeof user.id !== 'string' || !user.id || user.id.length > 200 ||
      typeof user.email !== 'string' || !correoVerificado(user)) return null;
  const email = user.email.trim().toLowerCase();
  return z.email().max(254).safeParse(email).success ? { id: user.id, email, emailVerified: true } : null;
}

function withCookies(data: unknown, source: Response) {
  const response = Response.json(data, { headers: PRIVATE });
  for (const cookie of source.headers.getSetCookie()) {
    if (NEON_COOKIES.has(cookie.split('=', 1)[0].trim())) response.headers.append('Set-Cookie', cookie);
  }
  return response;
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

  async function session(request: Request): Promise<Session | null> {
    const url = new URL('/api/auth/get-session', origin);
    // Bypass both the SDK's local cookie cache and the upstream cookie cache.
    url.searchParams.set('disableCookieCache', 'true');
    const result = await config.request(new Request(url, { headers: request.headers }), 'get-session');
    if (!result.ok) throw new Error('AUTH_PROVIDER_UNAVAILABLE');
    const body = await result.json() as { user?: unknown; session?: { id?: unknown; expiresAt?: unknown } } | null;
    const user = identity(body?.user);
    if (!user) return null;
    const expiresAt = typeof body?.session?.expiresAt === 'string' ? body.session.expiresAt : '';
    if (typeof body?.session?.id !== 'string' || !Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= Date.now()) return null;
    const profile = await invitation(user.email, user.id);
    return profile?.authUserId === user.id ? { user, session: { id: body.session.id, expiresAt } } : null;
  }

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/auth\//, '');
    const names = new Set((request.headers.get('cookie') ?? '').split(';').map((c) => c.trim().split('=')[0]));
    if (url.origin !== origin || names.has(COOKIE_ACCESO_QA)) return deny();
    if (request.method === 'GET') {
      if (path !== 'get-session') return deny(404);
      try { return Response.json(await session(request), { headers: PRIVATE }); }
      catch { return deny(503); }
    }
    if (request.method !== 'POST' || ![SEND, VERIFY, 'sign-out'].includes(path)) return deny();
    if (names.has(COOKIE_VISTA_PREVIA) && path !== 'sign-out') return deny();
    if (request.headers.get('origin') !== origin) return deny();
    if (!request.headers.get('content-type')?.startsWith('application/json')) return deny(415);

    try {
      const body = await readBody(request);
      if (!body) return deny(400);
      if (path === 'sign-out') {
        const response = await config.request(new Request(url, {
          method: 'POST', headers: request.headers, body: '{}',
        }), path);
        if (!response.ok || (await response.clone().json())?.success !== true) return deny(503);
        // Confirm revocation using the ORIGINAL cookie, not the new deletion cookie.
        const checkUrl = new URL('/api/auth/get-session?disableCookieCache=true', origin);
        const check = await config.request(new Request(checkUrl, { headers: request.headers }), 'get-session');
        if (!check.ok) return deny(503);
        const remaining = await check.json() as { session?: unknown; user?: unknown } | null;
        if (remaining?.session || remaining?.user) return deny(503);
        return withCookies({ success: true }, response);
      }

      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!z.email().max(254).safeParse(email).success) return deny(400);
      const send = path === SEND;
      if (send && body.type !== 'sign-in') return deny();
      if (!send && (typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp))) return deny(400);
      const allowed = await allowOtpRequest(db, config.secret, email, request.headers, send);
      const profile = await invitation(email);
      if (!allowed || !profile) return send ? Response.json({ success: true }, { headers: PRIVATE }) : deny(400);
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
          method: 'POST', headers: request.headers, body: JSON.stringify({ email, type: 'sign-in' }),
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
        method: 'POST', headers: request.headers, body: JSON.stringify({ email, otp: body.otp }),
      }), path);
      if (!response.ok) return deny(400);
      const result = await response.clone().json() as { user?: unknown } | null;
      const user = identity(result?.user);
      if (!user || user.email !== email || !response.headers.getSetCookie().some((cookie) =>
        /^(?:__Secure-)?neon-auth\.session_token=[^;]+/.test(cookie),
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
      return withCookies({ user }, response);
    } catch {
      // Never propagate SQL parameters, provider errors, identities, OTPs or cookies.
      return path === SEND ? Response.json({ success: true }, { headers: PRIVATE }) : deny(503);
    }
  }

  async function invoke(path: string, input: ApiInput) {
    const headers = new Headers(input.headers);
    const get = path === 'get-session';
    if (!get) headers.set('content-type', 'application/json');
    const response = await handler(new Request(new URL(`/api/auth/${path}`, origin), {
      method: get ? 'GET' : 'POST', headers, ...(get ? {} : { body: JSON.stringify(input.body ?? {}) }),
    }));
    if (!response.ok) throw new Error('ACCESO_NO_PERMITIDO');
    if (!get && path !== SEND) await config.writeCookies?.(response);
    return response.json();
  }

  return {
    handler,
    api: {
      getSession: async (input: ApiInput): Promise<Session | null> => invoke('get-session', input),
      sendVerificationOTP: (input: ApiInput): Promise<{ success: true }> => invoke(SEND, input),
      signInEmailOTP: (input: ApiInput): Promise<{ user: Identity }> => invoke(VERIFY, input),
      signOut: (input: ApiInput): Promise<{ success: true }> => invoke('sign-out', input),
    },
  };
}
