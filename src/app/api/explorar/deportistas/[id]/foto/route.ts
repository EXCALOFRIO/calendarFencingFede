import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';
import { ERROR_NO_AUTENTICADO } from '@/lib/sport/explorar/contexto';
import { contextoReal } from '@/lib/sport/explorar/real';
import { leerFotoDeportista } from '@/lib/sport/explorar/foto';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};

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
    const resultado = await leerFotoDeportista(
      { ...ctx, perfil: async () => perfil }, id, { signal: request.signal },
    );
    return Response.json(resultado, {
      status: resultado.estado === 'entrada_invalida' ? 400 : resultado.estado === 'no_disponible' ? 503 : 200,
      headers,
    });
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
