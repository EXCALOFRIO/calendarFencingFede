import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';
import { hayCriterios, leerCriterios } from '@/lib/sport/explorar/url';
import { PantallaBuscar, PantallaPaises } from '../pantalla-buscar';

export const dynamic = 'force-dynamic';
export const metadata = { title: NOMBRE_SECCION };

const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * Ámbitos Tiradores y Países de Explorar (`?ver=paises`).
 *
 * Tiradores sin nada escrito: la barra, los filtros, los recientes de este
 * navegador y sugerencias para seguir (que llegan después, sin retrasar la
 * barra). Con criterios (`?q=…`, `?arma=…`), la lista completa. Sin criterios
 * no se lee la base: la lista vacía no necesita consulta.
 */
export default async function Pagina({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');
  const params = await searchParams;
  if (primero(params.ver) === 'paises') return <PantallaPaises q={primero(params.q).slice(0, 40)} />;

  const ctx = contextoReal();
  const { criterios, cursor } = leerCriterios(params);
  if (!hayCriterios(criterios) && !cursor) {
    return <PantallaBuscar perfil={perfil} ctx={ctx} criterios={criterios} cursor={undefined} vista={{ tipo: 'sin_criterio' }} />;
  }
  const vista = await cargarExplorar(ctx, criterios, cursor);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');
  return <PantallaBuscar perfil={perfil} ctx={ctx} criterios={criterios} cursor={cursor} vista={vista} />;
}
