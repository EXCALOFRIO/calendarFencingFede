import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ handler: vi.fn(), preview: false, qa: false }));
vi.mock('@/lib/auth/server', () => ({ getAuth: () => ({ handler: h.handler }) }));
import { GET, POST } from '@/app/api/auth/[...path]/route';
import { accesoConContrasena } from '@/lib/auth/access-policy';

const BASE = 'https://app.example.test';
function llamar(path: string, body: unknown = { email: 'invitado@example.test', type: 'sign-in', otp: '123456' }, origin = BASE) {
  return POST(new Request(`${BASE}/api/auth/${path}`, {
    method: 'POST',
    headers: {
      origin, 'content-type': 'application/json',
      cookie: h.qa ? 'calendario_acceso_qa=invalid' : h.preview ? 'calendario_vista_previa=invalid' : '',
    },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ path: path.split('/') }) });
}

beforeEach(() => {
  h.handler.mockReset().mockImplementation(async () => Response.json({ success: true }));
  h.preview = false;
  h.qa = false;
});

describe('private D1 auth HTTP boundary', () => {
  it.each(['sign-up/email', 'sign-in/email', 'forget-password', 'reset-password', 'admin/create-user', 'change-email'])(
    'denies %s before invoking Better Auth', async (path) => {
      const result = await llamar(path);
      expect(result.status).toBe(403);
      expect(h.handler).not.toHaveBeenCalled();
      expect(result.headers.get('cache-control')).toBe('private, no-store');
    },
  );

  it('the retired local password switch cannot enable any passwords', () => {
    for (const environment of ['production', 'development', 'test']) {
      vi.stubEnv('NODE_ENV', environment);
      vi.stubEnv('ACCESO_CON_CONTRASENA', '1');
      expect(accesoConContrasena()).toBe(false);
    }
  });

  it('send responses are identical for invitation denial and provider failure', async () => {
    h.handler.mockResolvedValueOnce(Response.json({ secretProviderError: 'do not forward' }, { status: 403 }));
    const denied = await llamar('email-otp/send-verification-otp');
    h.handler.mockRejectedValueOnce(new Error('do not forward'));
    const failed = await llamar('email-otp/send-verification-otp');
    expect(denied.status).toBe(200);
    expect(failed.status).toBe(200);
    expect(await denied.json()).toEqual({ success: true });
    expect(await failed.json()).toEqual({ success: true });
  });

  it('delegates permitted OTP requests to the shared server-action/HTTP guards', async () => {
    expect((await llamar('email-otp/send-verification-otp')).ok).toBe(true);
    expect((await llamar('sign-in/email-otp')).ok).toBe(true);
    expect(h.handler).toHaveBeenCalledTimes(2);
    const request = h.handler.mock.calls[1][0] as Request;
    expect(await request.json()).toMatchObject({ email: 'invitado@example.test', otp: '123456' });
  });

  it('denies foreign/missing Origin and non-login OTP types', async () => {
    expect((await llamar('sign-in/email-otp', {}, 'https://externo.example.test')).status).toBe(403);
    expect((await llamar('sign-in/email-otp', {}, '')).status).toBe(403);
    expect((await llamar('email-otp/send-verification-otp', { email: 'invitado@example.test', type: 'email-verification' })).status).toBe(403);
    expect(h.handler).not.toHaveBeenCalled();
  });

  it('a preview cannot send codes or change identity', async () => {
    h.preview = true;
    expect((await llamar('email-otp/send-verification-otp')).status).toBe(403);
    expect((await llamar('sign-in/email-otp')).status).toBe(403);
    expect(h.handler).not.toHaveBeenCalled();
  });

  it('exposes only GET get-session, not arbitrary Better Auth reads', async () => {
    const req = new Request(`${BASE}/api/auth/get-session`);
    expect((await GET(req, { params: Promise.resolve({ path: ['get-session'] }) })).status).toBe(200);
    expect((await GET(req, { params: Promise.resolve({ path: ['admin', 'list-users'] }) })).status).toBe(404);
    expect(h.handler).toHaveBeenCalledTimes(1);
  });

  it('QA cannot read or mutate a personal session', async () => {
    h.qa = true;
    for (const path of ['sign-out', 'sign-in/email-otp', 'email-otp/send-verification-otp']) {
      expect((await llamar(path)).status).toBe(403);
    }
    expect((await GET(new Request(`${BASE}/api/auth/get-session`, {
      headers: { cookie: 'calendario_acceso_qa=invalid' },
    }), { params: Promise.resolve({ path: ['get-session'] }) })).status).toBe(403);
    expect(h.handler).not.toHaveBeenCalled();
  });

  it('bounds a chunked request before calling the provider', async () => {
    const response = await llamar('sign-in/email-otp', { email: 'x'.repeat(4096) });
    expect(response.status).toBe(413);
    expect(h.handler).not.toHaveBeenCalled();
  });

  it.each([null, [], 'not an object'])('rejects malformed payload %j', async (body) => {
    expect((await llamar('sign-in/email-otp', body)).status).toBe(400);
    expect(h.handler).not.toHaveBeenCalled();
  });

  it('failed redemption returns a generic error without setting a cookie', async () => {
    h.handler.mockResolvedValue(Response.json({ code: 'provider-specific' }, {
      status: 500, headers: { 'set-cookie': 'do-not-copy=secret' },
    }));
    const response = await llamar('sign-in/email-otp');
    expect(response.status).toBe(400);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.json()).toMatchObject({ code: 'ACCESO_NO_PERMITIDO' });
  });
});
