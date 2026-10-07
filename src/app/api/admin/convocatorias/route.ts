import { requireWritableRole } from '@/lib/auth/session';
import { crearConvocatoriaPara, MAX_PDF_CONVOCATORIA } from '@/lib/callups/crear';

/**
 * Alta de convocatoria con su PDF.
 *
 * Va por aquí y no por la acción de servidor porque las acciones admiten
 * 1 MB (`serverActions.bodySizeLimit` en next.config.ts) y un PDF de
 * convocatoria puede pasar de eso. El tope se comprueba con `Content-Length`
 * ANTES de leer el cuerpo, y la comprobación de origen es la misma que en
 * /api/auth: una cookie de sesión no basta para que otra web (o otro Worker
 * del mismo subdominio de workers.dev) cree convocatorias en nombre del admin.
 */

export const dynamic = 'force-dynamic';

/** El PDF más el resto del formulario y los separadores multipart. */
const MAX_CUERPO = MAX_PDF_CONVOCATORIA + 64 * 1024;
const PRIVADO = { 'Cache-Control': 'private, no-store' } as const;

function error(status: number, mensaje: string) {
  return Response.json({ ok: false, error: mensaje }, { status, headers: PRIVADO });
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return error(403, 'Origen no permitido.');
  }

  let perfil: Awaited<ReturnType<typeof requireWritableRole>>;
  try {
    perfil = await requireWritableRole('admin');
  } catch (e) {
    const noAutenticado = e instanceof Error && e.message === 'NO_AUTENTICADO';
    return noAutenticado
      ? error(401, 'Tienes que iniciar sesión.')
      : error(403, 'Esta acción es solo para administración.');
  }

  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    return error(415, 'Se esperaba un formulario.');
  }
  const longitud = Number(request.headers.get('content-length'));
  if (!request.headers.has('content-length') || !Number.isSafeInteger(longitud) || longitud < 0) {
    return error(411, 'Falta el tamaño del envío.');
  }
  if (longitud > MAX_CUERPO) {
    return error(413, 'El PDF pasa de 8 MB. Comprímelo o divídelo antes de subirlo.');
  }

  let datos: FormData;
  try {
    datos = await request.formData();
  } catch {
    return error(400, 'No se ha podido leer el formulario.');
  }

  const resultado = await crearConvocatoriaPara(perfil, datos);
  return Response.json(resultado, { status: resultado.ok ? 200 : 400, headers: PRIVADO });
}
