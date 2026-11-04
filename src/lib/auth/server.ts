import { createNeonAuth } from '@neondatabase/auth/next/server';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { createManagedAuth, type ProviderSession } from './managed-auth';
import { otpDailyLimit } from './rate-limit';
import { createSessionCache } from './session-cache';

/** Per isolate, shared by every request it serves. 30 s: see `session-cache.ts` for the residual risk. */
const sesionesValidadas = createSessionCache<ProviderSession>({ ttlMs: 30_000 });

/**
 * Una instancia por aislado y configuración: `createNeonAuth` monta la
 * instancia de better-auth (resolución de plugins, tabla de rutas, claves) y
 * `createManagedAuth` su API entera. Hacerlo en cada `getAuth()` pagaba ese
 * montaje en TODA petición autenticada, aunque la configuración nunca cambia
 * dentro de un aislado. La clave son los propios valores de configuración: si
 * alguno cambiara (pruebas con entornos distintos) se construye otra instancia
 * en vez de mezclar orígenes o secretos. En producción el Map tiene una sola
 * entrada siempre.
 */
const instancias = new Map<string, ReturnType<typeof construirAuth>>();

function construirAuth(origin: string, baseUrl: string, secret: string) {
  // `sessionDataTtl: 1` and `disableCookieCache` keep the SDK's signed-cookie
  // cache out of the way; the only reuse of a validated session is `sesionesValidadas`.
  const managed = createNeonAuth({
    baseUrl,
    cookies: { secret, sameSite: 'lax', sessionDataTtl: 1 },
    logLevel: 'silent',
  });
  const handlers = managed.handler();
  return createManagedAuth(db, {
    secret, origin,
    otpDailyLimit: otpDailyLimit(),
    sessionCache: sesionesValidadas,
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

/** Lazy: importing a page during a build must not resolve a Worker binding or secret. */
export function getAuth() {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  const baseUrl = process.env.NEON_AUTH_URL ?? process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? '';
  if (!origin || !baseUrl) throw new Error('Falta la configuración de Neon Auth y del origen de la aplicación.');
  const clave = `${origin}${baseUrl}${secret}${otpDailyLimit()}`;
  let instancia = instancias.get(clave);
  if (!instancia) {
    instancia = construirAuth(origin, baseUrl, secret);
    instancias.set(clave, instancia);
  }
  return instancia;
}
