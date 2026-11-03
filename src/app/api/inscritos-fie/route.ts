import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';
import { getSessionProfile } from '@/lib/auth/session';
import { cacheCompartida, HORA, MINUTO } from '@/lib/cache';
import { leerInscritosFie } from '@/lib/entries/inscritos-fie';

/**
 * La lista de inscritos de una prueba de la FIE, de TODOS los países, leída
 * en vivo de su API pública.
 *
 * La base sólo guarda los españoles (es la decisión de la ingestión, ver
 * `inscritosEspanolesDeLaFie`), así que para «a quién le toca en la poule»
 * hacía falta salir a fie.org. Esta ruta pide la misma lista que lee el
 * cron, la sanea con el mismo parseo y la devuelve sin copiarla a D1.
 *
 * Por qué ruta y no acción de servidor: las acciones del repo son escrituras
 * (`revalidatePath` detrás); las lecturas son `route.ts` con `Response.json`
 * y sus códigos (ver `explorar/sugerencias`). Es un GET con sesión exigida:
 * los datos son públicos en fie.org, pero regalar un proxy anónimo de la FIE
 * no tiene por qué.
 *
 * Caché compartida (`src/lib/cache`): la lista es la misma para todas las
 * cuentas, así que la clave es (temporada, competición) y ningún dato de la
 * sesión entra en ella. 15 minutos fresca: la lista se mueve con cada baja y
 * cada inscripción, pero una lectura de hace un cuarto de hora vale igual de
 * bien; un día de caducidad por si la FIE está caída, tiempo durante el cual
 * se sirve lo último mientras se revalida en segundo plano. La respuesta al
 * navegador va en `private, no-store`: quién la guarda es el servidor, no el
 * cliente.
 */
export const dynamic = 'force-dynamic';

const PRIVADO = { 'Cache-Control': 'private, no-store' } as const;

const listaFieCompartida = cacheCompartida.definir({
  espacio: 'inscritos-fie',
  /**
   * Ninguna dependencia de época: la lista cambia en la FIE cuando cambia, no
   * cuando ingiere nuestra base. La frescura la da `frescoMs`.
   */
  depende: [],
  frescoMs: 15 * MINUTO,
  caducaMs: 24 * HORA,
  cargar: leerInscritosFie,
});

function respuesta(cuerpo: Record<string, unknown>, status = 200): Response {
  return Response.json(cuerpo, { status, headers: PRIVADO });
}

export async function GET(request: Request): Promise<Response> {
  // La sesión va antes incluso de validar: ningún error expone nombres ni
  // detalles del servidor, igual que en `explorar/sugerencias`.
  let perfil: Awaited<ReturnType<typeof getSessionProfile>>;
  try {
    perfil = await getSessionProfile();
  } catch (error) {
    const caducada =
      error instanceof Error && 'digest' in error && error.digest === ERROR_VISTA_CADUCADA;
    return respuesta({ estado: caducada ? 'no_autenticado' : 'no_disponible' }, caducada ? 401 : 503);
  }
  if (!perfil) return respuesta({ estado: 'no_autenticado' }, 401);

  /*
    Sólo `temporada` y `competicion`, una vez cada una y sólo dígitos: son los
    dos números de la ruta de la FIE (`/competition/<temporada>/<competicion>`).
    Cualquier otra forma es una entrada inventada y se rechaza antes de pedir
    nada fuera.
  */
  const params = new URL(request.url).searchParams;
  const temporada = params.getAll('temporada');
  const competicion = params.getAll('competicion');
  if (
    [...params.keys()].some((k) => k !== 'temporada' && k !== 'competicion') ||
    temporada.length !== 1 ||
    competicion.length !== 1 ||
    !/^20\d{2}$/.test(temporada[0]) ||
    !/^\d{1,7}$/.test(competicion[0])
  ) {
    return respuesta({ estado: 'entrada_invalida' }, 400);
  }

  try {
    const lista = await listaFieCompartida(Number(temporada[0]), Number(competicion[0]));
    return respuesta(lista);
  } catch {
    // La FIE caída, un timeout o un JSON raro: se dice sin más, sin el stack.
    return respuesta({ estado: 'no_disponible' }, 503);
  }
}
