// Relativo y no `@/`: este módulo lo empaqueta Wrangler desde worker/index.ts.
import { COOKIE_ACCESO_QA } from '../auth/qa-token';

/**
 * Límites de peticiones delante de la aplicación, con la Rate Limiting API de
 * Workers (bindings `ratelimits` de `wrangler.jsonc`).
 *
 * Se comprueban en el Worker ANTES de servir: una petición cortada aquí no
 * llega a Next, no consulta D1, no llama a Neon Auth y no transforma imágenes.
 * Los contadores son por ubicación de Cloudflare y aproximados (así es la API);
 * sirven para frenar abusos, no para contar con exactitud. Las cuotas exactas
 * que importan (códigos de acceso) siguen en D1, detrás de estas.
 *
 * Los disparos `scheduled` no pasan por aquí: llaman a la aplicación por
 * dentro del Worker (ver worker/index.ts).
 */

/** Lo único de la Rate Limiting API que se usa. */
export type Limitador = {
  limit(opciones: { key: string }): Promise<{ success: boolean }>;
};

export const LIMITADORES = [
  'LIMITE_ACCESO',
  'LIMITE_CRON',
  'LIMITE_IMAGENES',
  'LIMITE_SUGERENCIAS',
  'LIMITE_FOTOS',
  'LIMITE_ARCHIVOS',
  'LIMITE_ACCIONES',
  'LIMITE_IP_SESION',
] as const;
export type NombreLimitador = (typeof LIMITADORES)[number];
export type EntornoLimites = { [K in NombreLimitador]?: Limitador };

type Clave = 'ip' | 'sesion';
type Regla = {
  nombre: string;
  limitador: NombreLimitador;
  clave: Clave;
  aplica(peticion: Request, ruta: string): boolean;
};

/**
 * Primera regla que coincide, gana. El orden importa: el POST de /entrar es
 * una acción de servidor, pero cuenta como acceso (por IP), no como acción.
 * Las cifras viven en `wrangler.jsonc`, una por binding.
 */
export const REGLAS: readonly Regla[] = [
  {
    nombre: 'acceso', limitador: 'LIMITE_ACCESO', clave: 'ip',
    aplica: (p, ruta) => ruta.startsWith('/api/auth/') || (p.method === 'POST' && ruta === '/entrar'),
  },
  { nombre: 'cron', limitador: 'LIMITE_CRON', clave: 'ip', aplica: (_p, ruta) => ruta.startsWith('/api/cron/') },
  { nombre: 'imagenes', limitador: 'LIMITE_IMAGENES', clave: 'ip', aplica: (_p, ruta) => ruta === '/_next/image' },
  {
    nombre: 'sugerencias', limitador: 'LIMITE_SUGERENCIAS', clave: 'sesion',
    aplica: (_p, ruta) => ruta === '/api/explorar/sugerencias',
  },
  {
    nombre: 'fotos', limitador: 'LIMITE_FOTOS', clave: 'sesion',
    // El lote (hasta 24 fotos) cuenta como una petición: sustituye a 24 individuales.
    aplica: (_p, ruta) => /^\/api\/explorar\/deportistas\/[^/]+\/foto$/.test(ruta) || ruta === '/api/explorar/fotos',
  },
  { nombre: 'archivos', limitador: 'LIMITE_ARCHIVOS', clave: 'sesion', aplica: (_p, ruta) => ruta.startsWith('/api/archivos/') },
  {
    nombre: 'acciones', limitador: 'LIMITE_ACCIONES', clave: 'sesion',
    aplica: (p) => p.method === 'POST' && p.headers.has('next-action'),
  },
];

const COOKIES_SESION = [
  '__Secure-neon-auth.session_token',
  'neon-auth.session_token',
  COOKIE_ACCESO_QA,
] as const;

/**
 * Ruta tal y como la enruta Next: sin `%xx` ni barras repetidas. Sin esto,
 * `/api/%61uth/...` o `/api//auth/...` se saltarían la regla.
 */
export function rutaNormalizada(url: URL): string {
  let ruta = url.pathname;
  try {
    ruta = decodeURIComponent(ruta);
  } catch {
    // Una ruta mal codificada no la sirve Next; se compara tal cual.
  }
  return ruta.replace(/\/{2,}/g, '/');
}

function ipDe(peticion: Request): string {
  // Cloudflare sobrescribe esta cabecera; nunca se lee x-forwarded-for.
  return peticion.headers.get('cf-connecting-ip') ?? 'sin-ip';
}

function leerCookie(cabecera: string, nombre: string): string | null {
  for (const parte of cabecera.split(';')) {
    const igual = parte.indexOf('=');
    if (igual > 0 && parte.slice(0, igual).trim() === nombre) {
      const valor = parte.slice(igual + 1).trim();
      return valor || null;
    }
  }
  return null;
}

export function cookieDeSesion(peticion: Request): string | null {
  const cabecera = peticion.headers.get('cookie');
  if (!cabecera) return null;
  for (const nombre of COOKIES_SESION) {
    const valor = leerCookie(cabecera, nombre);
    if (valor) return valor;
  }
  return null;
}

async function huella(valor: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor)));
  return Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** El token de sesión nunca se usa como clave en claro: sólo su huella. */
async function claveDe(peticion: Request, clave: Clave): Promise<string> {
  if (clave === 'sesion') {
    const sesion = cookieDeSesion(peticion);
    if (sesion) return `s:${await huella(sesion)}`;
  }
  return `ip:${ipDe(peticion)}`;
}

/** Sin binding (local, Vitest) o si la API falla, no se corta: se sirve. */
async function permitido(limitador: Limitador | undefined, key: string): Promise<boolean> {
  if (!limitador) return true;
  try {
    return (await limitador.limit({ key })).success;
  } catch {
    return true;
  }
}

export function respuestaDemasiadas(peticion: Request, ruta: string): Response {
  const cabeceras = {
    'Retry-After': '60',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const mensaje = 'Demasiadas peticiones seguidas. Espera un minuto y vuelve a intentarlo.';
  if (ruta.startsWith('/api/') || peticion.headers.has('next-action') || ruta === '/_next/image') {
    return Response.json({ ok: false, estado: 'demasiadas_peticiones', error: mensaje }, { status: 429, headers: cabeceras });
  }
  return new Response(peticion.method === 'HEAD' ? null : mensaje, {
    status: 429,
    headers: { ...cabeceras, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * `/_next/image` no lo usa ninguna pantalla (las fotos y carteles se enlazan a
 * la FIE con `<img>`), así que sin cookie de sesión no se atiende. Es una
 * comprobación de presencia, no de validez: validar la sesión aquí costaría
 * una llamada a Neon Auth por imagen. El límite por IP cubre el resto.
 */
function imagenSinSesion(ruta: string, peticion: Request): Response | null {
  if (ruta !== '/_next/image' || cookieDeSesion(peticion)) return null;
  return Response.json(
    { ok: false, error: 'Hace falta iniciar sesión.' },
    { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/**
 * Comprueba la regla de la petición y, si es por sesión, también un tope por
 * IP más holgado: si no, bastaría inventarse una cookie distinta en cada
 * petición para estrenar contador.
 */
export async function comprobarLimites(peticion: Request, entorno: EntornoLimites): Promise<Response | null> {
  const ruta = rutaNormalizada(new URL(peticion.url));
  const regla = REGLAS.find((r) => r.aplica(peticion, ruta));
  if (!regla) return null;
  const sinSesion = imagenSinSesion(ruta, peticion);
  if (sinSesion) return sinSesion;
  if (regla.clave === 'sesion' &&
      !(await permitido(entorno.LIMITE_IP_SESION, `ip:${ipDe(peticion)}`))) {
    return respuestaDemasiadas(peticion, ruta);
  }
  const clave = await claveDe(peticion, regla.clave);
  if (!(await permitido(entorno[regla.limitador], `${regla.nombre}:${clave}`))) {
    return respuestaDemasiadas(peticion, ruta);
  }
  return null;
}

export function conLimites<E extends object, C>(
  servir: (peticion: Request, entorno: E, contexto: C) => Promise<Response>,
) {
  return async (peticion: Request, entorno: E & EntornoLimites, contexto: C): Promise<Response> => {
    const cortada = await comprobarLimites(peticion, entorno);
    return cortada ?? servir(peticion, entorno, contexto);
  };
}
