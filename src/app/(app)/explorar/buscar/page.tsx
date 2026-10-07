import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { contextoReal } from '@/lib/sport/explorar/real';
import { CRITERIOS_VACIOS } from '@/lib/sport/explorar/url';
import { PantallaBuscar, PantallaPaises } from '../pantalla-buscar';

export const dynamic = 'force-dynamic';
export const metadata = { title: NOMBRE_SECCION };

const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * Pestaña Buscar sin nada escrito: la barra, los filtros, los recientes de
 * este navegador y sugerencias para seguir (que llegan después, sin retrasar
 * la barra). Al buscar, la URL pasa a `/explorar?q=…`, que pinta la misma
 * pantalla con la lista completa. Con `?ver=paises` es la pestaña Países.
 */
export default async function Pagina({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');
  const params = await searchParams;
  if (primero(params.ver) === 'paises') return <PantallaPaises q={primero(params.q).slice(0, 40)} />;
  return (
    <PantallaBuscar
      perfil={perfil}
      ctx={contextoReal()}
      criterios={CRITERIOS_VACIOS}
      cursor={undefined}
      vista={{ tipo: 'sin_criterio' }}
    />
  );
}
