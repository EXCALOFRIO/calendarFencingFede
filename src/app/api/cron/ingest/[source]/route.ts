import { isIngestSource, runIngest, SOURCE_DESCRIPTION } from '@/lib/ingest/runner';

/**
 * Ingestión disparada por cron (ver `vercel.json`, una fuente por franja).
 *
 * Una fuente por ruta, no una ruta que las recorra todas: si la FIE tarda tres
 * minutos, no puede arrastrar consigo el calendario de la RFEE, y en el registro
 * de Vercel se ve exactamente cuál falló.
 */

/**
 * Los scrapers pesados (once federaciones autonómicas, una a una) no caben en
 * los 60 s por defecto. 300 s es el máximo del plan de pago de Vercel; en Hobby
 * el techo real es menor y la función se cortará antes, lo que se verá como una
 * ejecución sin fila de cierre en `ingest_run`.
 */
export const maxDuration = 300;

/** Nunca cacheado: cada invocación tiene que ir de verdad a la fuente. */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const denegado = autorizarCron(request);
  if (denegado) return denegado;

  const { source } = await params;

  if (!isIngestSource(source)) {
    return Response.json(
      { ok: false, error: `Fuente desconocida: "${source}".` },
      { status: 404 },
    );
  }

  const resultado = await runIngest(source, { triggeredBy: 'cron' });

  /**
   * Siempre 200, incluso si la ingestión falló: `runIngest` no lanza y deja
   * constancia en `ingest_run`. Devolver 500 haría que Vercel marcase el cron
   * como caído y reintentase, lo que duplicaría las filas de ejecución sin
   * arreglar nada. El estado real va en el cuerpo y en el panel de admin.
   */
  return Response.json({
    ok: resultado.status !== 'error',
    fuente: source,
    descripcion: SOURCE_DESCRIPTION[source],
    ...resultado,
  });
}

/**
 * Protección del cron.
 *
 * Vercel añade `Authorization: Bearer $CRON_SECRET` a las invocaciones de cron
 * cuando la variable está definida en el proyecto. Sin ella, cualquiera podría
 * disparar los scrapers desde fuera y hacer que nos bloqueen las fuentes.
 *
 * Deliberadamente duplicado en las dos rutas de cron en lugar de extraído a un
 * módulo común: son quince líneas y así cada ruta se puede leer entera sin
 * saltar de fichero, que es justo lo que uno quiere al auditar un endpoint
 * público.
 */
function autorizarCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // En producción sin secreto no se abre: un endpoint que dispara scrapers
    // no puede quedar público por un despiste de configuración.
    if (process.env.NODE_ENV === 'production') {
      return Response.json(
        {
          ok: false,
          error:
            'Falta CRON_SECRET en el entorno. Defínela en Vercel para que el ' +
            'cron pueda ejecutarse.',
        },
        { status: 503 },
      );
    }
    // En desarrollo se permite, para poder probar con curl sin montar nada.
    return null;
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  }

  return null;
}
