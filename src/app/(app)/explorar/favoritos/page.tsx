import { redirect } from 'next/navigation';
import { EstadoFavoritos, ListaFavoritos } from '@/components/explorar/favoritos';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarFavoritos } from '@/lib/sport/explorar/favoritos-pantalla';
import { leerCursorFavoritos } from '@/lib/sport/explorar/favoritos-url';
import { contextoReal } from '@/lib/sport/explorar/real';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mis favoritos' };

/**
 * Lista propia de favoritos: fichas deportivas guardadas para volver a ellas.
 * Cuelga de Explorar (y del perfil) en lugar de ocupar un destino de la barra.
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección. La cuenta sale siempre de la sesión: de la
 * URL sólo se lee el cursor de página, que además queda ligado a esa cuenta, de
 * modo que ningún parámetro permite ver la lista de otra. Es privada: no
 * incluye datos de cuenta, ranking interno ni avisos.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const cursor = leerCursorFavoritos(await searchParams) || undefined;
  const vista = await cargarFavoritos(contextoReal(), cursor);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h1 className="text-3xl leading-none sm:text-4xl">Favoritos</h1>

      {vista.tipo === 'ok' && !vista.sinResultados ? (
        <ListaFavoritos items={vista.items} siguiente={vista.siguiente} cursorActual={cursor} />
      ) : (
        <EstadoFavoritos vista={vista} cursorActual={cursor} />
      )}
    </div>
  );
}
