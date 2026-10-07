import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { RUTA_SIGUIENDO } from '@/lib/sport/explorar/siguiendo-url';

export const dynamic = 'force-dynamic';

/**
 * «Favoritos» es «Siguiendo» (`docs/diseno-sistema.md`, diccionario): la
 * lista vive en Tú › Siguiendo. Esta ruta se queda para los enlaces viejos.
 * El cursor de favoritos no vale para la lista de Siguiendo, así que no se
 * pasa: se abre la primera página. Sin sesión, a la entrada, como el resto.
 */
export default async function Pagina() {
  if (!(await getSessionProfile())) redirect('/entrar');
  redirect(RUTA_SIGUIENDO);
}
