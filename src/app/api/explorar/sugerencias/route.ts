import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';
import { ERROR_NO_AUTENTICADO } from '@/lib/sport/explorar/contexto';
import { contextoReal } from '@/lib/sport/explorar/real';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { sugerenciasPublicasCompartidas } from '@/lib/sport/explorar/sugerencias-cache-real';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

export async function GET(request: Request): Promise<Response> {
  const ctx = contextoReal();
  // La sesión va antes incluso de validar: una cookie inválida nunca usa otra
  // identidad y ningún error expone nombres, entrada ni detalles del servidor.
  try {
    const perfil = await ctx.perfil();
    if (!perfil) return Response.json({ estado: 'no_autenticado' }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    // Sólo `q` (una vez) y, opcional, `limite` (una vez, entero sin ceros a la
    // izquierda); el rango lo valida `sugerirPersonas`.
    const limite = params.getAll('limite');
    if ([...params.keys()].some((k) => k !== 'q' && k !== 'limite') || params.getAll('q').length !== 1
      || limite.length > 1 || (limite.length === 1 && !/^[1-9]\d?$/.test(limite[0]))) {
      return Response.json({ estado: 'entrada_invalida' }, { status: 400, headers });
    }
    // La respuesta sigue siendo privada (`seguida` es de la cuenta); lo que se
    // comparte entre cuentas es sólo la parte pública, dentro del servidor.
    const resultado = await sugerirPersonas({ ...ctx, perfil: async () => perfil }, {
      q: params.get('q'),
      ...(limite.length === 1 ? { limite: Number(limite[0]) } : {}),
    }, { publicas: sugerenciasPublicasCompartidas });
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
