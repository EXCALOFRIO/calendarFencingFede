import { r2Bucket } from '@/lib/storage';

/**
 * Sirve los ficheros guardados en el cubo de R2 (PDFs de convocatoria y
 * snapshots del scraper).
 *
 * Por qué pasa por aquí y no por una URL pública del cubo: los PDFs de
 * convocatoria llevan listas nominales de convocados. Un cubo con el dominio
 * `r2.dev` abierto es un directorio de datos personales accesible a cualquiera
 * que adivine una ruta, y las rutas llevan el id del evento, que es público.
 * Con una ruta propia, el día que haga falta restringir el acceso se restringe
 * aquí, en un sitio, sin migrar ninguna URL ya guardada en la base de datos.
 *
 * Hoy el acceso es abierto, igual que lo era con Vercel Blob: esto es un
 * cambio de sitio, no un cambio de política. La URL es larga e impredecible
 * (lleva un timestamp), que es la misma protección que había antes.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ruta: string[] }> },
) {
  const cubo = r2Bucket();

  if (!cubo) {
    return Response.json(
      {
        ok: false,
        error:
          'No hay cubo de R2 en este entorno. Esta ruta solo sirve ficheros ' +
          'cuando la aplicación corre como Worker de Cloudflare.',
      },
      { status: 503 },
    );
  }

  const { ruta } = await params;
  const clave = ruta.map((tramo) => decodeURIComponent(tramo)).join('/');

  // Cortafuegos para rutas con "..": R2 no tiene directorios de verdad, pero
  // una clave así solo puede venir de alguien trasteando.
  if (clave.includes('..')) {
    return Response.json({ ok: false, error: 'Ruta no válida.' }, { status: 400 });
  }

  const objeto = await cubo.get(clave);

  if (!objeto || !objeto.body) {
    return Response.json(
      { ok: false, error: 'Ese fichero ya no está.' },
      { status: 404 },
    );
  }

  return new Response(objeto.body, {
    headers: {
      'Content-Type': objeto.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(objeto.size),
      ETag: objeto.httpEtag,
      // Los ficheros nunca se sobrescriben (la clave lleva timestamp), así que
      // se pueden cachear sin miedo durante un año.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
