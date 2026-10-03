import { getAuthenticatedProfile } from '@/lib/auth/session';

/** Enlaces privados históricos: nunca crean cuentas ni inician otra sesión. */
const PAPELES: Record<string, string> = {
  admin: 'admin',
  seleccionador: 'coach',
  coach: 'coach',
  tirador: 'athlete',
  tiradora: 'athlete',
  athlete: 'athlete',
};

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ quien: string }> },
) {
  const real = await getAuthenticatedProfile();
  if (!real) {
    return new Response(null, {
      status: 303,
      headers: { Location: '/entrar', 'Cache-Control': 'private, no-store' },
    });
  }
  const { quien } = await params;
  const role = Object.hasOwn(PAPELES, quien) ? PAPELES[quien] : undefined;
  if (real.role !== 'admin' || !role) {
    return new Response('No disponible.', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(`/vista-previa?rol=${role}`, request.url).toString(),
      'Cache-Control': 'private, no-store',
    },
  });
}
