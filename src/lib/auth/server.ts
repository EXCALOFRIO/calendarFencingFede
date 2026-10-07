import { createNeonAuth } from '@neondatabase/auth/next/server';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { createManagedAuth } from './managed-auth';
import { otpDailyLimit } from './rate-limit';

/** Lazy: importing a page during a build must not resolve a Worker binding or secret. */
export function getAuth() {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  const baseUrl = process.env.NEON_AUTH_URL ?? process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? '';
  if (!origin || !baseUrl) throw new Error('Falta la configuración de Neon Auth y del origen de la aplicación.');
  const managed = createNeonAuth({
    baseUrl,
    cookies: { secret, sameSite: 'lax', sessionDataTtl: 1 },
    logLevel: 'silent',
  });
  const handlers = managed.handler();
  return createManagedAuth(db, {
    secret, origin,
    otpDailyLimit: otpDailyLimit(),
    request: (request, path) => {
      const context = { params: Promise.resolve({ path: path.split('/') }) };
      return request.method === 'GET' ? handlers.GET(request, context) : handlers.POST(request, context);
    },
    async writeCookies(response) {
      const store = await cookies();
      for (const header of response.headers.getSetCookie()) {
        for (const [name, attributes] of parseSetCookieHeader(header)) store.set(name, attributes.value, {
          httpOnly: true, secure: name.startsWith('__Secure-') || process.env.NODE_ENV === 'production',
          sameSite: 'lax', path: '/',
          ...(attributes.expires ? { expires: new Date(attributes.expires) } : {}),
          ...(attributes['max-age'] !== undefined ? { maxAge: attributes['max-age'] } : {}),
        });
      }
    },
  });
}
