import { and, eq, exists, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { athlete, callUp, callUpAthlete } from '@/db/schema';
import { getSessionProfile } from '@/lib/auth/session';
import { r2Bucket } from '@/lib/storage';

/**
 * Sirve los PDFs de convocatoria guardados en el cubo de R2, y nada más del
 * cubo (ni snapshots del scraper ni copias internas).
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
 * sesión y el permiso en D1 (ver `puedeVerPdf`).
 *
 * Límite conocido: no se pueden recuperar copias que se hubieran cacheado o
 * descargado con la política anterior, ni cubre un dominio externo delante del
 * cubo (`R2_PUBLIC_BASE_URL`).
 */

export const dynamic = 'force-dynamic';

const PRIVADO = { 'Cache-Control': 'private, no-store' } as const;

type Perfil = NonNullable<Awaited<ReturnType<typeof getSessionProfile>>>;

/**
 * Permiso en D1 sobre el PDF de una convocatoria: tiene que haber una
 * convocatoria de ese evento cuyo `pdf_url` termine en esta clave, y la cuenta
 * tiene que ser admin (que también ve los borradores que prepara) o gestionar
 * a uno de sus convocados en una convocatoria ya publicada.
 *
 * Se compara el final de la URL guardada y no la URL entera para que sigan
 * valiendo las claves antiguas (`<hora>-<nombre>.pdf`) aunque el origen de la
 * aplicación haya cambiado desde que se subieron.
 */
async function puedeVerPdf(perfil: Perfil, eventId: string, clave: string): Promise<boolean> {
  const sufijo = `/api/archivos/${clave}`;
  const delPdf = and(
    eq(callUp.eventId, eventId),
    sql`substr(${callUp.pdfUrl}, -${sufijo.length}) = ${sufijo}`,
  );
  const convocado = exists(
    db.select({ uno: sql`1` })
      .from(callUpAthlete)
      .innerJoin(athlete, eq(athlete.id, callUpAthlete.athleteId))
      .where(and(
        eq(callUpAthlete.callUpId, callUp.id),
        eq(athlete.active, true),
        or(eq(athlete.userProfileId, perfil.profileId), eq(athlete.guardianProfileId, perfil.profileId)),
      )),
  );
  const [fila] = await db
    .select({ id: callUp.id })
    .from(callUp)
    .where(perfil.role === 'admin' ? delPdf : and(delPdf, eq(callUp.published, true), convocado))
    .limit(1);
  return Boolean(fila);
}

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
  let clave: string;
  try {
    clave = ruta.map((tramo) => decodeURIComponent(tramo)).join('/');
  } catch {
    return respuesta({ ok: false, error: 'Ruta no válida.' }, 400);
  }

  // Cortafuegos para rutas con "..": R2 no tiene directorios de verdad, pero
  // una clave así solo puede venir de alguien trasteando.
  if (!clave || clave.length > 512 || clave.includes('..') || /[\\\u0000-\u001f]/u.test(clave)) {
    return respuesta({ ok: false, error: 'Ruta no válida.' }, 400);
  }
  // Solo PDFs de convocatoria: `convocatorias/<evento>/<fichero>`. Snapshots
  // del scraper, copias internas y cualquier otro prefijo del cubo los leen
  // solo los adaptadores del servidor, nunca esta ruta.
  const partes = /^convocatorias\/([^/]+)\/[^/]+$/.exec(clave);
  if (!partes) {
    return respuesta({ ok: false, error: 'Ese fichero ya no está.' }, 404);
  }

  let permitido: boolean;
  try {
    permitido = await puedeVerPdf(perfil, partes[1], clave);
  } catch {
    return respuesta({ ok: false, error: 'No se pudo comprobar el permiso.' }, 503);
  }
  // 404 y no 403: no se confirma que la convocatoria exista a quien no la ve.
  if (!permitido) {
    return respuesta({ ok: false, error: 'Ese fichero ya no está.' }, 404);
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
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
      ...(objeto.httpMetadata?.contentType?.includes('html')
        ? { 'Content-Disposition': 'attachment' }
        : {}),
      ...PRIVADO,
    },
  });
}
