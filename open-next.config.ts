import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * Configuración del adaptador de Cloudflare (OpenNext).
 *
 * Sin caché incremental a propósito: **todas** las páginas y rutas de esta
 * aplicación declaran `export const dynamic = 'force-dynamic'` (comprobado:
 * 24 de 24 ficheros con directiva). No hay ISR, ni `use cache`, ni páginas
 * prerenderizadas que revalidar, así que un cubo de R2 para la caché
 * incremental sería un cubo vacío y una dependencia más que crear antes de
 * desplegar.
 *
 * Si algún día se añade una página con `revalidate`, hay que volver aquí:
 *
 *   import r2IncrementalCache from
 *     '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';
 *   export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
 *
 * y añadir el binding `NEXT_INC_CACHE_R2_BUCKET` en `wrangler.jsonc`.
 */
export default defineCloudflareConfig();
