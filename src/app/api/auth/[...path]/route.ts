import { auth } from '@/lib/auth/server';

/**
 * Proxy de autenticación de Neon Auth.
 *
 * Todas las llamadas de sesión (inicio, cierre, verificación) pasan por aquí,
 * de modo que las cookies se ponen en nuestro propio dominio y no hay que
 * lidiar con cookies de terceros, que es lo que rompe los navegadores móviles.
 */
export const { GET, POST } = auth.handler();

// La autenticación nunca puede servirse desde caché.
export const dynamic = 'force-dynamic';
