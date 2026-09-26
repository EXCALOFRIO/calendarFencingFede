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

/** Lo poco que necesitamos del entorno del Worker. */
type Entorno = {
  CRON_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

/** Forma del `ScheduledController` de Workers, sin arrastrar workers-types. */
type Disparo = { readonly cron: string; readonly scheduledTime: number };

/** Forma del `ExecutionContext` de Workers. */
type Contexto = { waitUntil(promesa: Promise<unknown>): void };

type ManejadorFetch = (
  peticion: Request,
  entorno: Entorno,
  contexto: Contexto,
) => Promise<Response>;

const servir = (aplicacion as { fetch: ManejadorFetch }).fetch;

/**
 * Reparto cron -> ruta. Copia literal de `vercel.json`.
 *
 * Las claves tienen que coincidir CARÁCTER A CARÁCTER con las expresiones de
 * `triggers.crons` en `wrangler.jsonc`: Cloudflare entrega en
 * `controller.cron` la cadena exacta que configuraste, y si no está en esta
 * tabla la ejecución no hace nada (y se registra como aviso).
 */
const TAREAS: Record<string, string> = {
  '0 3 * * *': '/api/cron/ingest/skermo_rfee',
  '30 3 * * *': '/api/cron/ingest/fie',
  '0 4 * * *': '/api/cron/ingest/efc',
  '30 4 * * *': '/api/cron/ingest/skermo_regional',
  '0 5 * * *': '/api/cron/ingest/rfee_wp',
  '30 5 * * *': '/api/cron/ingest/skermo_ranking',
  // Extracción asistida de las circulares en PDF. Va después de todas las
  // ingestiones: así procesa lo que se acaba de descubrir esa misma noche.
  '0 6 * * *': '/api/cron/extraer',
  // Fichas de la FIE de NUESTROS tiradores: foto y puesto mundial. Va al
  // final porque depende de que existan las fichas, no de las fuentes.
  '45 6 * * *': '/api/cron/ingest/fie_tiradores',
  '0 7 * * *': '/api/cron/notify',
};

async function ejecutarTarea(
  ruta: string,
  entorno: Entorno,
  contexto: Contexto,
): Promise<void> {
  const base = entorno.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || 'https://localhost';

  const cabeceras = new Headers({ 'user-agent': 'cloudflare-cron/1.0' });
  if (entorno.CRON_SECRET) {
    cabeceras.set('authorization', `Bearer ${entorno.CRON_SECRET}`);
  }

  const respuesta = await servir(
    new Request(`${base}${ruta}`, { method: 'GET', headers: cabeceras }),
    entorno,
    contexto,
  );

  /**
   * El cuerpo se lee entero aunque no se use: las rutas de ingestión
   * responden en streaming y, si nadie consume el cuerpo, el Worker puede
   * terminar antes de que el trabajo acabe.
   *
   * Solo se registra un resumen. Nada de volcar la respuesta: lleva nombres de
   * tiradores y el registro de Cloudflare no es sitio para datos personales.
   */
  const cuerpo = await respuesta.text();
  console.log(
    `[cron] ${ruta} -> ${respuesta.status} (${cuerpo.length} bytes de respuesta)`,
  );
}

export default {
  fetch: servir,

  async scheduled(disparo: Disparo, entorno: Entorno, contexto: Contexto) {
    const ruta = TAREAS[disparo.cron];

    if (!ruta) {
      console.warn(
        `[cron] La expresión "${disparo.cron}" no tiene ninguna tarea asignada ` +
          'en worker/index.ts. Revisa que coincida con wrangler.jsonc.',
      );
      return;
    }

    /**
     * Se espera a que termine (no `waitUntil` y a correr): en una invocación
     * programada nadie está esperando una respuesta, y si el Worker se cierra
     * antes de tiempo la ingestión queda a medias y sin fila de cierre en
     * `ingest_run`.
     *
     * Tampoco se relanza el error: dejar que suba marcaría la ejecución como
     * fallida y Cloudflare la reintentaría, duplicando filas sin arreglar
     * nada. Es la misma decisión que ya tomaban las rutas devolviendo 200.
     */
    try {
      await ejecutarTarea(ruta, entorno, contexto);
    } catch (error) {
      console.error(
        `[cron] ${ruta} ha lanzado:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  },
};
