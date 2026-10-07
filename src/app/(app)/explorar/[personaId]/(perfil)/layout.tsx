import { redirect } from 'next/navigation';
import { ControlFavoritoFicha } from '@/components/explorar/favoritos';
import { EstadoFicha } from '@/components/explorar/ficha-deportiva';
import { MarcaFichaPropia } from '@/components/explorar/perfil/ficha-propia';
import { CabeceraPerfil } from '@/components/explorar/perfil/secciones-perfil';
import { TransicionSeccion } from '@/components/explorar/perfil/transicion-seccion';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cabeceraPerfil, exigirSesion, favoritoPerfil, personaDeSegmento } from './datos';

export const dynamic = 'force-dynamic';

/**
 * Perfil de una persona indexada, abierto siempre por su identificador: dos
 * homónimos nunca comparten ficha. El layout pinta la cabecera compacta y las
 * pestañas una vez; debajo va la sección de la URL (Resultados en la raíz),
 * que lee sólo sus datos. El título («Perfil») lo pone la cabecera de la
 * aplicación (`cabeceraDeRuta`). La ficha no lee ni envía datos de cuenta
 * (correo, tutor, consentimiento, licencias) de ninguna persona, tenga cuenta
 * o no. Nada aquí llama a una fuente externa.
 */
export default async function LayoutPerfil({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ personaId: string }>;
}) {
  await exigirSesion();
  const personaId = personaDeSegmento((await params).personaId);
  if (!personaId) return <EstadoFicha vista={{ tipo: 'entrada_invalida' }} />;

  // Independientes entre sí: el favorito no espera a la ficha (y si falla, sólo se omite).
  const [{ vista, extras }, favorito] = await Promise.all([cabeceraPerfil(personaId), favoritoPerfil(personaId)]);
  if (vista.tipo === 'sin_sesion' || favorito.tipo === 'sin_sesion') redirect('/entrar');
  if (vista.tipo !== 'ok') return <EstadoFicha vista={vista} />;

  const chips = chipsRanking({
    nacional: extras.rankingNacional,
    mundial: extras.rankingMundial,
    resumenMundial: extras.resumenMundial,
    ambitos: extras.rankingAmbitos ?? null,
    olimpica: extras.olimpica,
  });
  // La vuelta atrás la da la flecha global de la cabecera de la aplicación.
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MarcaFichaPropia personaId={personaId} propia={vista.ficha.esPropia} />
      <CabeceraPerfil
        ficha={vista.ficha}
        datos={extras.datos}
        chips={chips}
        extras={extras}
        acciones={
          <ControlFavoritoFicha
            estado={favorito}
            nombre={nombreVisible(vista.ficha.nombre) || vista.ficha.nombre}
            reintentar={`${RUTA_EXPLORAR}/${personaId}`}
          />
        }
      />
      <TransicionSeccion>{children}</TransicionSeccion>
    </div>
  );
}
