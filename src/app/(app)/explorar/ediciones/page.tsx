import { redirect } from 'next/navigation';
import { PantallaEdiciones } from '@/components/explorar/catalogo-ediciones';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarCatalogoCompartido } from '@/lib/sport/explorar/cache-real';
import { leerCriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import { contextoReal } from '@/lib/sport/explorar/real';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Competiciones' };

/**
 * Catálogo paginado de todas las competiciones importadas (una fila por
 * evento, con sus ediciones juntas) y series especiales.
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección. Sólo lee lo ya indexado en D1: no llama a
 * ninguna fuente externa, no inventa ediciones ni pruebas y no incluye datos de
 * cuenta ni ranking interno. Volver es la flecha de la cabecera. La primera
 * página de cada búsqueda y las series salen de la caché compartida.
 */
export default async function Pagina({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const { criterios, cursor } = leerCriteriosCatalogo(await searchParams);
  // Las armas de la cuenta sólo eligen qué edición abre cada evento; la lista es la misma para todos.
  const { series: vista, catalogo } = await cargarCatalogoCompartido(contextoReal(), criterios, cursor, {
    armasPreferidas: perfil.weapons,
  });
  if (vista.tipo === 'sin_sesion' || catalogo.estado === 'sin_sesion') redirect('/entrar');

  return <PantallaEdiciones catalogo={catalogo} criterios={criterios} cursor={cursor} series={vista} />;
}
