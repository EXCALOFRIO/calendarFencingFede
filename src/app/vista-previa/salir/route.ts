import { cookies } from 'next/headers';
import { COOKIE_VISTA_PREVIA } from '@/lib/auth/preview-token';
import { getAuthenticatedProfile } from '@/lib/auth/session';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) {
    return new Response('No autorizado.', { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const almacen = await cookies();
  if (almacen.has(COOKIE_ACCESO_QA)) {
    almacen.delete(COOKIE_ACCESO_QA);
    almacen.delete(COOKIE_VISTA_PREVIA);
    return new Response(null, {
      status: 303,
      headers: { Location: '/entrar', 'Cache-Control': 'private, no-store' },
    });
  }
  const admin = await getAuthenticatedProfile();
  if (!admin || admin.role !== 'admin') {
    return new Response('No autorizado.', { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  }
  almacen.delete(COOKIE_VISTA_PREVIA);
  return new Response(null, {
    status: 303,
    headers: { Location: '/vista-previa', 'Cache-Control': 'private, no-store' },
  });
}
