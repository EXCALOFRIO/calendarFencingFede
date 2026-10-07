import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { contextoReal } from '@/lib/sport/explorar/real';
import { CRITERIOS_VACIOS } from '@/lib/sport/explorar/url';
import { PantallaBuscar } from '../pantalla-buscar';

export const dynamic = 'force-dynamic';
export const metadata = { title: NOMBRE_SECCION };

/**
 * Pestaña Buscar sin nada escrito: la barra, los filtros, los recientes de
 * este navegador y sugerencias para seguir (que llegan después, sin retrasar
 * la barra). Al buscar, la URL pasa a `/explorar?q=…`, que pinta la misma
 * pantalla con la lista completa.
 */
export default async function Pagina() {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');
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
