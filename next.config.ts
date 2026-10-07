import type { NextConfig } from 'next';

/**
 * CSP en modo Report-Only: el navegador avisa en la consola de lo que
 * bloquearía, sin bloquear nada. Next mete scripts en línea (el payload RSC,
 * `self.__next_f.push(...)`) y estilos en línea; sin nonces por petición
 * hacen falta `'unsafe-inline'` en ambos. Las imágenes externas son las que
 * pinta la app con `<img>`: carteles de static.fie.org, retratos del
 * redimensionador de fie.org (`/cdn-cgi/image/...`) y los logotipos de
 * `escudo.tsx` (fie.org y esgrima.es).
 */
export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://static.fie.org https://fie.org https://esgrima.es data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const CABECERAS_SEGURIDAD = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  /**
   * Sólo para HTML y API que sirve el Worker. `/_next/static` y `public/` los
   * sirve Cloudflare Assets sin pasar por Next, así que no llevan estas
   * cabeceras (y no las necesitan para lo que protegen).
   */
  async headers() {
    return [
      // '/(.*)' y no '/:path*': con el comparador estricto de Next, '/:path*' no casa con '/'.
      { source: '/(.*)', headers: CABECERAS_SEGURIDAD },
      {
        // frame-ancestors sí se aplica, no sólo se informa. /api/archivos queda
        // fuera porque pone su propia CSP (con `sandbox` y el mismo
        // frame-ancestors) y una cabecera de aquí no debe pisarla.
        source: '/((?!api/archivos/).*)',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }],
      },
    ];
  },

  experimental: {
    /**
     * 1 MB (el valor por defecto de Next): ninguna acción necesita más. El
     * PDF de convocatoria, que sí, sube por su propia ruta,
     * `/api/admin/convocatorias`, con su propio tope.
     */
    serverActions: { bodySizeLimit: '1mb' },
    // Volver a una pestaña vista hace menos de 30 s no repite el render de servidor.
    staleTimes: { dynamic: 30 },
  },

  /**
   * Imágenes remotas que `next/image` puede optimizar.
   *
   * En Cloudflare, `/_next/image` lo atiende el propio Worker y la
   * transformación la hace el binding `IMAGES` (ver `wrangler.jsonc`): el
   * Worker descarga el original, lo redimensiona **en memoria** y lo
   * devuelve. No se guarda ninguna copia en R2 ni en ningún sitio, que es la
   * diferencia entre redimensionar y rehospedar.
   *
   * `static.fie.org` sirve los carteles oficiales de la FIE en JPEG de 4000 px
   * de ancho para huecos de 200. Sin esta entrada, `next/image` rechaza la URL
   * y la imagen no se pinta.
   *
   * Los PDFs de convocatoria ya no están en Vercel Blob sino en R2, y se
   * sirven desde nuestro propio origen (`/api/archivos/...`), que no necesita
   * estar en esta lista.
   *
   * Hoy ninguna pantalla usa `next/image` (todo va con `<img>`), así que esto
   * es lo mínimo por si se usa: sólo `/uploads/**`, que es donde la FIE cuelga
   * carteles y fotos, una calidad y pocos anchos. Cada combinación distinta de
   * URL, ancho y calidad es una transformación de pago, y además el Worker
   * exige cookie de sesión y limita `/_next/image` por IP
   * (src/lib/seguridad/limites.ts).
   */
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'static.fie.org', pathname: '/uploads/**', search: '' }],
    qualities: [75],
    deviceSizes: [640, 1080],
    imageSizes: [96, 256],
  },
};

/**
 * NO se llama aquí a `initOpenNextCloudflareForDev()`, y es a propósito.
 *
 * Esa función es la forma oficial de que `next dev` vea los bindings de
 * Cloudflare, y para conseguirlo levanta un `workerd` hijo del servidor de
 * desarrollo. Como nuestro `main` de `wrangler.jsonc` apunta a un entrypoint
 * propio que importa `.open-next/worker.js`, ese `workerd` se queda con
 * `.open-next/` abierto, y en Windows eso significa que `npm run cf:build`
 * falla nada más empezar:
 *
 *   EBUSY: resource busy or locked, rmdir '...\.open-next\assets'
 *
 * Es decir: con la llamada puesta, no se puede compilar mientras haya un
 * `next dev` levantado. Comprobado, no supuesto.
 *
 * Ahora DB (D1) también es obligatorio. `next dev` sin contexto sirve para
 * trabajar en componentes, no para consultar datos ni autenticar cuentas:
 * esas operaciones fallan de forma cerrada, sin respaldo Neon/S3.
 * Para probar los bindings locales está `npm run cf:preview`, que corre el
 * Worker entero. No activar bindings remotos de producción para una demo.
 */

export default nextConfig;
