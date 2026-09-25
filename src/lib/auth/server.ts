import { createNeonAuth } from '@neondatabase/auth/next/server';

/**
 * Autenticación con Neon Auth (Better Auth gestionado por Neon).
 *
 * Por qué esto y no autenticación a mano: hashear contraseñas, emitir y rotar
 * tokens de sesión, recuperación de cuenta... es donde más se la pega la
 * gente. Es más código, más superficie de ataque y cero ventaja aquí.
 *
 * Y por qué gestionado y no la librería suelta: los usuarios se guardan en el
 * esquema `neon_auth` de NUESTRA propia base de datos (comprobado: existen
 * `neon_auth.user`, `session`, `account`, `verification`, `jwks`). O sea, no
 * es una caja negra de un tercero: son tablas consultables con SQL normal, en
 * la misma base que las de tirador y club.
 *
 * Nota sobre el plan original: decía que la tabla era `neon_auth.users_sync`.
 * En este proyecto, ya aprovisionado, la tabla real es `neon_auth.user`.
 *
 * `user_profile.auth_user_id` apunta a ese id, pero SIN clave ajena: ese
 * esquema lo migra Neon, y encadenar nuestras migraciones a las suyas es pedir
 * que un cambio suyo nos rompa los despliegues.
 */
const baseUrl = process.env.NEON_AUTH_URL ?? process.env.NEON_AUTH_BASE_URL;
const cookieSecret =
  process.env.NEON_AUTH_COOKIE_SECRET ?? process.env.BETTER_AUTH_SECRET;

/**
 * Se comprueba aquí en lugar de dejar que falle la librería: su error
 * ("Missing required config: cookies.secret") no dice de dónde sale ese valor
 * ni cómo generarlo, y es lo primero con lo que se tropieza cualquiera que
 * clone el repositorio.
 */
if (!baseUrl) {
  throw new Error(
    'Falta NEON_AUTH_URL. Cópiala del panel de Neon (pestaña Auth) al .env.',
  );
}

if (!cookieSecret) {
  throw new Error(
    'Falta NEON_AUTH_COOKIE_SECRET. Genera uno de 32 bytes en base64 ' +
      '(por ejemplo con `openssl rand -base64 32`) y ponlo en el .env, ' +
      'y también en las variables de entorno de Vercel.',
  );
}

export const auth = createNeonAuth({
  baseUrl,
  cookies: { secret: cookieSecret, sameSite: 'lax' },
  logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
});

export type NeonAuthUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
};
