import { redirect } from 'next/navigation';
import { PantallaListaSiguiendo } from '@/components/explorar/pantalla-siguiendo';
import { getSessionProfile } from '@/lib/auth/session';
import { fuentesPropuestasCompartidas } from '@/lib/sport/explorar/cache-real';
import { cargarListaSiguiendo } from '@/lib/sport/explorar/inicio-pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';
import { leerCriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Siguiendo' };

/**
 * Pestaña Siguiendo: la lista de personas que sigue la cuenta, con «Siguiendo»
 * para dejar de seguir. Sus resultados están en «Para ti» (`/explorar`).
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección. La cuenta sale siempre de la sesión: de la
 * URL sólo se lee el cursor, ligado a la cuenta, así que ningún parámetro
 * enseña la lista de otra.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const { cursor } = leerCriteriosSiguiendo(await searchParams);
  const ctx = contextoReal();
  const vista = await cargarListaSiguiendo(ctx, cursor || undefined, fuentesPropuestasCompartidas(ctx));
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  return <PantallaListaSiguiendo vista={vista} />;
}
