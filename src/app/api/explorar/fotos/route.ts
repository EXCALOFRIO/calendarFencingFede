import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';
import { r2Bucket } from '@/lib/storage';
import { ERROR_NO_AUTENTICADO } from '@/lib/sport/explorar/contexto';
import { contextoReal } from '@/lib/sport/explorar/real';
import { leerFotosDeportistas, MAX_FOTOS_POR_LOTE } from '@/lib/sport/explorar/foto-lote';
import { almacenR2 } from '@/lib/sport/explorar/fotos/cache';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};
/** Como la ruta individual: sólo un lote entero de respuestas definitivas se reutiliza en el navegador. */
const headersCacheables = { ...headers, 'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800' };

const IDS_RE = /^[0-9a-f-]{36}(?:,[0-9a-f-]{36}){0,63}$/i;

/**
 * `GET /api/explorar/fotos?ids=<uuid>,<uuid>…`: las fotos de las filas visibles
 * de una lista en una petición (ver `foto-lote.ts`). Metadatos, no píxeles, y
 * el único parámetro admitido es la lista de ids: no es un proxy de URLs.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = contextoReal();
    const perfil = await ctx.perfil();
    if (!perfil) return Response.json({ estado: 'no_autenticado' }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const crudo = params.get('ids') ?? '';
    if ([...params.keys()].some((k) => k !== 'ids') || params.getAll('ids').length !== 1 || !IDS_RE.test(crudo)) {
      return Response.json({ estado: 'entrada_invalida' }, { status: 400, headers });
    }
    const ids = crudo.split(',');
    if (ids.length > MAX_FOTOS_POR_LOTE) return Response.json({ estado: 'entrada_invalida' }, { status: 400, headers });
    const cubo = r2Bucket();
    const resultado = await leerFotosDeportistas(
      { ...ctx, perfil: async () => perfil }, ids,
      { signal: request.signal, almacen: cubo ? almacenR2(cubo) : null },
    );
    if (resultado.estado !== 'ok') {
      return Response.json(resultado, { status: resultado.estado === 'entrada_invalida' ? 400 : 503, headers });
    }
    const definitivo = Object.values(resultado.fotos).every((f) => f.estado === 'publicada' || f.estado === 'foto_no_publicada');
    return Response.json(resultado, { status: 200, headers: definitivo ? headersCacheables : headers });
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
