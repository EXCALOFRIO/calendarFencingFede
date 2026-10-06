import { redirect } from 'next/navigation';
import { PantallaEdiciones } from '@/components/explorar/catalogo-ediciones';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarCatalogoEdiciones } from '@/lib/sport/explorar/catalogo';
import { leerCriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import { cargarSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ediciones y series' };

/**
 * Catálogo paginado de todas las ediciones importadas y series especiales.
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección. Sólo lee lo ya indexado en D1: no llama a
 * ninguna fuente externa, no inventa ediciones ni pruebas y no incluye datos de
 * cuenta ni ranking interno. Volver es la flecha de la cabecera.
 */
export default async function Pagina({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const { criterios, cursor } = leerCriteriosCatalogo(await searchParams);
  const entrada = Object.fromEntries(Object.entries(criterios).filter(([, valor]) => valor));
  const ctx = contextoReal();
  const [vista, catalogo] = await Promise.all([
    cargarSeries(ctx),
    cargarCatalogoEdiciones(ctx, { ...entrada, ...(cursor ? { cursor } : {}) }),
  ]);
  if (vista.tipo === 'sin_sesion' || catalogo.estado === 'sin_sesion') redirect('/entrar');

  return <PantallaEdiciones catalogo={catalogo} criterios={criterios} cursor={cursor} series={vista} />;
}
