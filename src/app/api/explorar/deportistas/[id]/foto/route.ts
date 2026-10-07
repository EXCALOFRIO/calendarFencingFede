import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';
import { r2Bucket } from '@/lib/storage';
import { ERROR_NO_AUTENTICADO } from '@/lib/sport/explorar/contexto';
import { contextoReal } from '@/lib/sport/explorar/real';
import { leerFotoDeportista } from '@/lib/sport/explorar/foto';
import { almacenR2 } from '@/lib/sport/explorar/fotos/cache';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Una respuesta definitiva (foto o «no publicada») se puede reutilizar un día
 * en el navegador de quien ya tiene sesión, y una semana más mientras se
 * revalida: sólo contiene enlaces públicos de la FIE, que no cambian de un día
 * para otro. `private` impide que la guarde un intermediario. Lo pasajero
 * (503) y lo de sesión siguen sin guardarse.
 */
const headersCacheables = { ...headers, 'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800' };

/**
 * Devuelve metadatos, no píxeles: servir la foto desde nuestro dominio
 * contradiría la política de la FIE descrita en el lector de ingestión.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = contextoReal();
    const perfil = await ctx.perfil();
    if (!perfil) return Response.json({ estado: 'no_autenticado' }, { status: 401, headers });
    if (new URL(request.url).search) {
      return Response.json({ estado: 'entrada_invalida' }, { status: 400, headers });
    }
    const { id } = await params;
    const cubo = r2Bucket();
    const resultado = await leerFotoDeportista(
      { ...ctx, perfil: async () => perfil }, id,
      { signal: request.signal, almacen: cubo ? almacenR2(cubo) : null },
    );
    const status = resultado.estado === 'entrada_invalida' ? 400 : resultado.estado === 'no_disponible' ? 503 : 200;
    return Response.json(resultado, { status, headers: status === 200 ? headersCacheables : headers });
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
