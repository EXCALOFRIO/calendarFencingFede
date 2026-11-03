import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import cacheEnEstaticos from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

/**
 * Configuración del adaptador de Cloudflare (OpenNext).
 *
 * Caché incremental **en los propios static assets del Worker**
 * (`cdn-cgi/_next_cache/<buildId>/`, servida por el binding `ASSETS`, que ya
 * existe). Las páginas de la aplicación son todas `force-dynamic` —no hay ISR
 * que revalidar— pero SÍ hay rutas prerenderizadas en el manifiesto de build:
 * `/manifest.webmanifest`, `/icon.svg`, `/icon.png`, `/apple-icon.png`,
 * `/_not-found` y `/_global-error`. Sin caché incremental, cada petición a
 * esas rutas reejecuta su route handler dentro del Worker; con ella se sirven
 * leyendo el fichero `.cache` sembrado en los assets.
 *
 * No cuesta nada ni pide bindings nuevos: `opennextjs-cloudflare
 * preview|deploy|upload` copia `.open-next/cache/` dentro de los assets al
 * desplegar (`populateCache`), y el acceso es una lectura del ASSETS binding,
 * que no es una invocación extra. Al estar bajo `cdn-cgi/` esos ficheros no
 * son accesibles desde fuera, sólo desde el propio Worker.
 *
 * Es de SÓLO LECTURA: si algún día una página declara `revalidate` (ISR de
 * verdad) o se usa `unstable_cache`/`use cache` con persistencia, los `set`
 * fallan con un error en el registro y la entrada no se actualiza nunca.
 * En ese momento hay que cambiar a:
 *
 *   import r2IncrementalCache from
 *     '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';
 *   export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
 *
 * y añadir el binding `NEXT_INC_CACHE_R2_BUCKET` en `wrangler.jsonc`.
 */
export default defineCloudflareConfig({ incrementalCache: cacheEnEstaticos });
