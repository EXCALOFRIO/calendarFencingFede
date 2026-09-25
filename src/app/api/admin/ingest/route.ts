import { requireRole } from '@/lib/auth/session';
import {
  INGEST_SOURCES,
  SOURCE_DESCRIPTION,
  isIngestSource,
  runIngest,
} from '@/lib/ingest/runner';

/**
 * Botón "Actualizar ahora" del panel de administración.
 *
 * Es la misma ingestión que la del cron, pero autenticada con SESIÓN DE ADMIN
 * en lugar de con `CRON_SECRET`. Se separa en dos rutas a propósito: el secreto
 * del cron no debe circular por el navegador, y una cookie de sesión no llega
 * a una invocación de cron. Mezclarlas obligaría a aceptar las dos formas de
 * autenticación en el mismo endpoint, que es como se cuelan los agujeros.
 */

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let perfil: Awaited<ReturnType<typeof requireRole>>;
  try {
    perfil = await requireRole('admin');
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    // NO_AUTENTICADO es "no has entrado" (401); el resto es "has entrado pero
    // esto no es para tu rol" (403). Distinguirlos ahorra soporte.
    const status = mensaje === 'NO_AUTENTICADO' ? 401 : 403;
    return Response.json(
      {
        ok: false,
        error:
          status === 401
            ? 'Tienes que iniciar sesión para lanzar una actualización.'
            : mensaje,
      },
      { status },
    );
  }

  const source = await leerFuente(request);

  if (!source) {
    return Response.json(
      {
        ok: false,
        error: 'Falta la fuente a actualizar.',
        fuentesValidas: INGEST_SOURCES,
      },
      { status: 400 },
    );
  }

  if (!isIngestSource(source)) {
    return Response.json(
      {
        ok: false,
        error: `Fuente desconocida: "${source}".`,
        fuentesValidas: INGEST_SOURCES,
      },
      { status: 400 },
    );
  }

  /**
   * Queda registrado quién la lanzó. Cuando una ejecución manual se solape con
   * el cron y aparezcan dos filas seguidas en `ingest_run`, esto es lo que
   * explica por qué.
   */
  const resultado = await runIngest(source, {
    triggeredBy: `admin:${perfil.email}`,
  });

  return Response.json({
    ok: resultado.status !== 'error',
    fuente: source,
    descripcion: SOURCE_DESCRIPTION[source],
    ...resultado,
  });
}

/**
 * La fuente puede venir en el cuerpo JSON o en la cadena de consulta: así el
 * panel puede llamar con `fetch` y también se puede probar a mano con curl.
 */
async function leerFuente(request: Request): Promise<string | null> {
  const enQuery = new URL(request.url).searchParams.get('source');
  if (enQuery) return enQuery;

  try {
    const body = (await request.json()) as { source?: unknown };
    return typeof body.source === 'string' ? body.source : null;
  } catch {
    // Sin cuerpo o con JSON mal formado: no es un error del servidor.
    return null;
  }
}
