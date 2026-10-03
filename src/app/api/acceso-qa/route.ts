import { cookies } from 'next/headers';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { userProfile } from '@/db/schema';
import { COOKIE_VISTA_PREVIA } from '@/lib/auth/preview-token';
import {
  COOKIE_ACCESO_QA,
  DURACION_SESION_QA,
  comprobarClaveQa,
  firmarSesionQa,
  leerConcesionQa,
} from '@/lib/auth/qa-token';

export const dynamic = 'force-dynamic';
const PRIVADO = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

function denegar() {
  return new Response(null, { status: 404, headers: PRIVADO });
}

async function leerCuerpoAcotado(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const lector = request.body.getReader();
  const partes: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512) {
        await lector.cancel();
        return null;
      }
      partes.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(partes));
  } finally {
    lector.releaseLock();
  }
}

/** Desactivado salvo una concesión temporal creada desde el control de Cloudflare. */
export async function POST(request: Request) {
  const concesion = leerConcesionQa();
  const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? '';
  if (
    !concesion || secret.length < 32 ||
    request.headers.get('origin') !== new URL(request.url).origin ||
    !request.headers.get('content-type')?.startsWith('application/json')
  ) return denegar();

  let clave: unknown;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 512) return denegar();
    const texto = await leerCuerpoAcotado(request);
    if (texto === null) return denegar();
    const body = JSON.parse(texto) as { clave?: unknown } | null;
    clave = body?.clave;
  } catch {
    return denegar();
  }
  if (!comprobarClaveQa(clave, concesion)) return denegar();

  // No crea una cuenta ni enlaza una identidad con un correo existente.
  const [admin] = await db.select({ id: userProfile.id }).from(userProfile)
    .where(and(
      eq(userProfile.id, concesion.adminProfileId),
      eq(userProfile.role, 'admin'),
      ne(userProfile.inviteStatus, 'revocada'),
    )).limit(1).catch(() => []);
  if (!admin) return denegar();

  const issuedAt = Date.now();
  if (issuedAt >= concesion.expiresAt) return denegar();
  const valor = firmarSesionQa({
    version: 1,
    grantId: concesion.id,
    adminProfileId: admin.id,
    issuedAt,
    expiresAt: Math.min(issuedAt + DURACION_SESION_QA, concesion.expiresAt),
  }, secret);
  const almacen = await cookies();
  almacen.delete(COOKIE_VISTA_PREVIA);
  almacen.set(COOKIE_ACCESO_QA, valor, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    // Permanece al caducar: nunca se vuelve silenciosamente a otra identidad.
  });
  return new Response(null, { status: 204, headers: PRIVADO });
}
