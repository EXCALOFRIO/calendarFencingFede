import { getSessionProfile } from '@/lib/auth/session';
import { r2Bucket } from '@/lib/storage';

/**
 * Sirve los ficheros guardados en el cubo de R2 (PDFs de convocatoria,
 * borradores y snapshots del scraper).
 *
 * Por qué pasa por aquí y no por una URL pública del cubo: los PDFs de
 * convocatoria llevan listas nominales de convocados, y las rutas llevan el id
 * del evento, que es público. Aquí se exige una sesión vigente **antes** de
 * tocar el cubo: `getSessionProfile` devuelve `null` sin sesión y con la cuenta
 * revocada, y en ambos casos no se lee nada de R2. Una URL larga no es un
 * control de acceso.
 *
 * Toda respuesta es `private, no-store`: ni los navegadores ni los
 * intermediarios guardan el fichero, y cada petición vuelve a comprobar la
 * sesión. No hay ACL por destinatario, solo «con sesión vigente».
 *
 * Límite conocido: no se pueden recuperar copias que se hubieran cacheado o
 * descargado con la política anterior, ni cubre un dominio externo delante del
 * cubo (`R2_PUBLIC_BASE_URL`).
 */

export const dynamic = 'force-dynamic';

const PRIVADO = { 'Cache-Control': 'private, no-store' } as const;

function respuesta(cuerpo: Record<string, unknown>, status: number) {
  return Response.json(cuerpo, { status, headers: PRIVADO });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ruta: string[] }> },
) {
  let perfil: Awaited<ReturnType<typeof getSessionProfile>>;
  try {
    perfil = await getSessionProfile();
  } catch {
    return respuesta(
      { ok: false, error: 'No se pudo comprobar la sesión.' },
      503,
    );
  }

  if (!perfil) {
    return respuesta({ ok: false, error: 'Hace falta iniciar sesión.' }, 401);
  }

  const cubo = r2Bucket();

  if (!cubo) {
    return respuesta(
      {
        ok: false,
        error:
          'No hay cubo de R2 en este entorno. Esta ruta solo sirve ficheros ' +
          'cuando la aplicación corre como Worker de Cloudflare.',
      },
      503,
    );
  }

  const { ruta } = await params;
  const clave = ruta.map((tramo) => decodeURIComponent(tramo)).join('/');

  // Cortafuegos para rutas con "..": R2 no tiene directorios de verdad, pero
  // una clave así solo puede venir de alguien trasteando.
  if (clave.includes('..')) {
    return respuesta({ ok: false, error: 'Ruta no válida.' }, 400);
  }

  const objeto = await cubo.get(clave);

  if (!objeto || !objeto.body) {
    return respuesta({ ok: false, error: 'Ese fichero ya no está.' }, 404);
  }

  return new Response(objeto.body, {
    headers: {
      'Content-Type': objeto.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(objeto.size),
      ETag: objeto.httpEtag,
      ...PRIVADO,
    },
  });
}
