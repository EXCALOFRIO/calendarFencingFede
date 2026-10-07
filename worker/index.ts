/**
 * Punto de entrada del Worker de Cloudflare.
 *
 * OpenNext genera `.open-next/worker.js` con el `fetch` que sirve la
 * aplicación Next.js. Ese fichero no sabe nada de crons, así que aquí se
 * reexporta tal cual y se le añade el manejador `scheduled`, que es el
 * sustituto de los crons de `vercel.json`.
 *
 * Por qué un manejador `scheduled` y no dejar las rutas expuestas a un
 * disparador externo: en Vercel el cron entraba por HTTP con la cabecera
 * `Authorization: Bearer $CRON_SECRET`. Aquí el disparo es interno al Worker,
 * pero se construye la MISMA petición con la MISMA cabecera y se pasa por el
 * `fetch` de la aplicación. Así las rutas de `src/app/api/cron/**` no cambian
 * ni una línea, su comprobación de `CRON_SECRET` sigue siendo la única puerta,
 * y se pueden seguir disparando a mano con curl igual que antes.
 */

// El fichero lo genera `opennextjs-cloudflare build`; en un árbol limpio
// todavía no existe.
// @ts-ignore .open-next/worker.js se genera en tiempo de compilación
import { default as aplicacion } from '../.open-next/worker.js';
import { crearAlmacenCronD1 } from '../src/lib/cron/almacen-d1';
import { crearManejadorProgramado, type FetchCron } from '../src/lib/cron/programado';
import { conMantenimiento } from '../src/lib/cron/mantenimiento';
import { conLimites } from '../src/lib/seguridad/limites';

const servir = (aplicacion as { fetch: FetchCron }).fetch;

export default conMantenimiento(
  // HTTP manual conserva la autorización de las rutas y permite un rerun
  // deliberado; sólo los disparos scheduled pasan por la reserva persistente.
  // Los límites de peticiones (bindings `ratelimits`) sólo cubren el HTTP:
  // el `scheduled` de abajo llama a `servir` directamente.
  conLimites(servir),
  // Esperar al EOF y al cierre, no lanzar el trabajo y dejarlo en waitUntil.
  crearManejadorProgramado({ servir, crearAlmacen: crearAlmacenCronD1 }),
);
