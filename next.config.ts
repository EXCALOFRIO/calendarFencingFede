import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // El scraper y las rutas de cron hacen fetch a fuentes externas; no cachear.
    serverActions: { bodySizeLimit: '8mb' },
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
   */
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'static.fie.org' }],
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
