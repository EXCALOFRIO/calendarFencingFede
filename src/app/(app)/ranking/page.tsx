import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { leerFiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { cargarClasificacionFie, cargarRankingEuropeo, cargarRankingNacional } from './consultas';
import { cargarPantallaRanking, leerVistaRanking } from './datos';
import { VistaRanking } from './vista';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ranking' };

/**
 * Ranking de la temporada.
 *
 * -------------------------------------------------------------------------
 * DOS NÚMEROS, Y SE DICE CUÁL ES CUÁL
 * -------------------------------------------------------------------------
 * Manda la clasificación OFICIAL de la RFEE: la que la gente reconoce y la que
 * decide convocatorias. El cálculo interno no se tira, porque es lo único
 * auditable: entra dentro del panel de cada tirador con ficha, debajo del
 * puesto oficial y con su nombre puesto. El razonamiento de por qué no son dos
 * pestañas está en `tabla-oficial.tsx`.
 *
 * Sin clasificación oficial publicada NO se cae al cálculo interno: sería
 * enseñar a cualquier cuenta un ranking privado como si fuera el de la
 * federación. Nunca se enseñan las dos a la vez, ninguna recalcula nada al
 * vuelo y, si falta algo, se dice.
 *
 * Las lecturas están en `datos.ts` y el pintado en `vista.tsx`, para poder
 * medir y capturar la pantalla sin servidor (`tests/ui/ranking-moderno.mts`).
 *
 * Sin `loading.tsx` a propósito (`docs/diseno-sistema.md` § 5): la navegación
 * es una Transition y la pantalla anterior sigue a la vista hasta que esta
 * está lista, en vez de pasar por un esqueleto.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');
  const params = await searchParams;
  const datos = await cargarPantallaRanking(perfil, leerFiltroRankingNacional(params), leerVistaRanking(params));
  return (
    <VistaRanking
      datos={datos}
      cargar={cargarClasificacionFie}
      cargarNacional={cargarRankingNacional}
      cargarEuropeo={cargarRankingEuropeo}
    />
  );
}
