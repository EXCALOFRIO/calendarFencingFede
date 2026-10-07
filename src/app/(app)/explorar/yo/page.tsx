import { redirect } from 'next/navigation';
import { salir } from '@/app/(app)/salir';
import { describirCuenta } from '@/components/tu/cuenta';
import { seccionesDeTu } from '@/components/tu/filas';
import { FilaSalir, IdentidadTu, ListaTu } from '@/components/tu/lista-tu';
import { getManagedAthletes, getSessionProfile } from '@/lib/auth/session';
import { getCurrentSeason } from '@/lib/queries/calendar';
import { listCallUpsForAthletes } from '@/lib/queries/callups';
import { resolverPersonaPropia } from '@/lib/sport/explorar/propietario';
import { contextoReal } from '@/lib/sport/explorar/real';
import { rutaFicha } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tú' };

/**
 * Pestaña «Tú»: quién eres y una lista de filas que abren subpantallas (tu
 * ficha, Siguiendo, Mi estado, Convocatorias, Tiradores, Gestión y los
 * ajustes), con «Cerrar sesión» al final. Qué filas salen depende del papel
 * (`seccionesDeTu`).
 *
 * La ficha propia se resuelve aquí y no en la barra, que se pinta en todas
 * las pantallas. Si falla, la fila lleva a la cuenta: la pantalla no se cae
 * por eso.
 */
export default async function Pagina() {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [propia, atletas, temporada] = await Promise.all([
    resolverPersonaPropia(contextoReal(), perfil.profileId).catch((error: unknown) => {
      console.error('[tu] la ficha propia no se pudo resolver:', error instanceof Error ? error.name : 'desconocido');
      return null;
    }),
    getManagedAthletes(perfil.profileId),
    getCurrentSeason(),
  ]);

  // Sólo un tirador necesita contarlas: a quien gestiona la selección la fila le sale siempre.
  const convocatorias =
    perfil.role === 'athlete'
      ? await listCallUpsForAthletes(atletas.map((a) => a.id)).then((l) => l.length, () => 0)
      : 0;

  const cuenta = describirCuenta(perfil, atletas, temporada);
  const secciones = seccionesDeTu({
    role: perfil.role,
    fichaPropia: propia?.estado === 'confirmada' ? rutaFicha(propia.personaId) : null,
    convocatorias,
  });

  return (
    <div className="flex w-full min-w-0 flex-col gap-[24px] lg:mx-auto lg:max-w-2xl">
      <IdentidadTu nombre={cuenta.nombre} iniciales={cuenta.iniciales} segundaLinea={cuenta.segundaLinea} />
      <ListaTu secciones={secciones} />
      <FilaSalir accion={salir} />
    </div>
  );
}
