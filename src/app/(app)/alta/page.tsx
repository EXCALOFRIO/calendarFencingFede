import { Buscador } from '@/components/alta/buscador';
import { FichaVinculada } from '@/components/alta/ficha-vinculada';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import { buscarEnRanking, vincularFicha } from './acciones';
import { getResumenFicha } from './consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vincula tu ficha' };

/**
 * «Vincula tu ficha»: la pantalla que faltaba para que una cuenta recién
 * creada sirva de algo.
 *
 * Hasta ahora, quien se registraba no tenía ficha de tirador, y sin ficha la
 * aplicación no sabe su arma ni su categoría: el calendario no filtra nada,
 * «Mi estado» sale vacío y el ranking no le dice nada. La única salida era
 * pedirle a un administrador que se la creara a mano.
 *
 * Y no hacía falta, porque el dato ya estaba dentro: el ranking oficial de la
 * RFEE se ingiere cada noche con nombre, licencia, fecha de nacimiento, club,
 * arma, género, categoría, puesto y puntos de 808 tiradores. Esta pantalla solo
 * hace que una persona pueda reconocerse en esa lista.
 *
 * -------------------------------------------------------------------------
 * DOS ESTADOS, UNA URL
 * -------------------------------------------------------------------------
 * Si la cuenta NO tiene ficha, se enseña el buscador. Si la tiene —porque
 * acaba de vincularla o porque volvió a mirar—, se enseña la ficha con su
 * puesto oficial. Son la misma pantalla a propósito: la confirmación de que el
 * alta funcionó es exactamente lo que se ve al volver, así que no hay dos
 * versiones de la verdad que puedan separarse.
 *
 * No hay redirección forzosa desde `/` hacia aquí, y es una decisión: un
 * seleccionador y la dirección técnica tampoco tienen ficha, y no tienen por
 * qué acabar en una pantalla de alta cada vez que entran.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ hecha?: string }>;
}) {
  const perfil = await requireProfile();
  const [atletas, parametros] = await Promise.all([
    getManagedAthletes(perfil.profileId),
    searchParams,
  ]);

  const mia = atletas[0];
  if (mia) {
    const resumen = await getResumenFicha(mia.id);
    if (resumen) {
      return (
        <FichaVinculada
          resumen={resumen}
          reciente={parametros.hecha === '1'}
          varias={atletas.length > 1}
        />
      );
    }
  }

  return (
    <Buscador
      buscar={buscarEnRanking}
      vincular={vincularFicha}
      nombreCuenta={perfil.fullName}
      esPersonal={perfil.role === 'athlete' || perfil.role === 'guardian'}
    />
  );
}
