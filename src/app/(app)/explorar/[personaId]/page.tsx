import { redirect } from 'next/navigation';
import { EstadoFicha, FichaCompleta } from '@/components/explorar/ficha-deportiva';
import { ControlFavoritoFicha } from '@/components/explorar/favoritos';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarEstadoFavorito } from '@/lib/sport/explorar/favoritos-pantalla';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { construirUrlFicha, leerCriteriosFicha, personaDeRuta } from '@/lib/sport/explorar/ficha-url';
import { cargarExtrasPerfil, EXTRAS_VACIOS } from '@/lib/sport/explorar/perfil-extra';
import { contextoReal } from '@/lib/sport/explorar/real';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ficha deportiva' };

/**
 * Ficha deportiva de una persona indexada, abierta siempre por su
 * identificador: dos homónimos nunca comparten ficha.
 *
 * La guarda de sesión va aquí además de en el layout, porque un layout no se
 * vuelve a ejecutar al navegar entre páginas hermanas y esta ruta se puede
 * abrir escribiendo la dirección. La ficha no lee ni envía datos de cuenta
 * (correo, tutor, consentimiento, licencias) de ninguna persona, tenga cuenta
 * o no. Nada aquí llama a una fuente externa.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ personaId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [{ personaId: segmento }, consulta] = await Promise.all([params, searchParams]);
  const personaId = personaDeRuta(segmento);
  const criterios = leerCriteriosFicha(consulta);

  // Independientes entre sí: ni el favorito ni los datos personales y el
  // rendimiento esperan a la ficha (y si fallan, sólo se omiten).
  const [vista, favorito, extras] = personaId
    ? await Promise.all([
        cargarFichaPantalla(contextoReal(), personaId, criterios),
        cargarEstadoFavorito(contextoReal(), personaId),
        cargarExtrasPerfil(contextoReal(), personaId),
      ])
    : ([{ tipo: 'entrada_invalida' }, { tipo: 'no_encontrada' }, EXTRAS_VACIOS] as const);
  if (vista.tipo === 'sin_sesion' || favorito.tipo === 'sin_sesion') redirect('/entrar');

  const base = `${RUTA_EXPLORAR}/${personaId}`;

  // La vuelta atrás la da la flecha global de la cabecera de la aplicación.
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {vista.tipo === 'ok' && personaId ? (
        <FichaCompleta
          ficha={vista.ficha}
          historial={vista.historial}
          base={base}
          criterios={criterios}
          nivel="pagina"
          extras={extras}
          acciones={
            <ControlFavoritoFicha
              estado={favorito}
              nombre={nombreVisible(vista.ficha.nombre) || vista.ficha.nombre}
              reintentar={construirUrlFicha(base, criterios)}
            />
          }
        />
      ) : vista.tipo === 'ok' ? null : (
        <>
          <h1 className="text-2xl sm:text-3xl">Ficha deportiva</h1>
          <EstadoFicha vista={vista} />
        </>
      )}
    </div>
  );
}
