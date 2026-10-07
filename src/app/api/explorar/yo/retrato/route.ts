import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';
import { ERROR_NO_AUTENTICADO } from '@/lib/sport/explorar/contexto';
import { resolverPersonaPropia } from '@/lib/sport/explorar/propietario';
import { contextoReal } from '@/lib/sport/explorar/real';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Una hora en el navegador de esa cuenta y nunca en un intermediario: la
 * pestaña «Tú» de la barra la pide una vez por visita, y resolver la ficha
 * propia cuesta varias lecturas en D1. Vincular una ficha se nota como
 * mucho una hora después en la barra; en la pantalla «Tú», al momento.
 */
const headersCacheables = { ...headers, 'Cache-Control': 'private, max-age=3600, stale-while-revalidate=86400' };

const CUENTA_RE = /^[\w-]{1,64}$/;

/**
 * `GET /api/explorar/yo/retrato?cuenta=<profileId>`: qué persona deportiva es
 * la de la cuenta, para pintar su foto en la pestaña «Tú». La foto se pide
 * después a la ruta de siempre (`/api/explorar/deportistas/<id>/foto`).
 *
 * `cuenta` sólo separa en la caché del navegador las respuestas de dos
 * cuentas que entran en el mismo dispositivo; tiene que ser la de la sesión.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = contextoReal();
    const perfil = await ctx.perfil();
    if (!perfil) return Response.json({ estado: 'no_autenticado' }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const cuenta = params.get('cuenta') ?? '';
    if ([...params.keys()].some((k) => k !== 'cuenta') || !CUENTA_RE.test(cuenta) || cuenta !== perfil.profileId) {
      return Response.json({ estado: 'entrada_invalida' }, { status: 400, headers });
    }
    const propia = await resolverPersonaPropia(ctx, perfil.profileId);
    if (propia.estado === 'no_disponible') return Response.json({ estado: 'no_disponible' }, { status: 503, headers });
    return Response.json(
      { estado: 'ok', personaId: propia.estado === 'confirmada' ? propia.personaId : null },
      { status: 200, headers: headersCacheables },
    );
  } catch (error) {
    const autenticacion = error instanceof Error && (
      error.message === ERROR_NO_AUTENTICADO ||
      ('digest' in error && error.digest === ERROR_VISTA_CADUCADA)
    );
    return Response.json({ estado: autenticacion ? 'no_autenticado' : 'no_disponible' }, {
      status: autenticacion ? 401 : 503, headers,
    });
  }
}
