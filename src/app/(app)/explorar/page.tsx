import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { BuscadorInicio } from '@/components/explorar/buscador-inicio';
import { CabeceraInicio, EnlaceSiguiendo, EstadoSiguiendo, FeedSiguiendo } from '@/components/explorar/siguiendo';
import { TransicionContenido } from '@/components/sistema/transicion';
import { getSessionProfile } from '@/lib/auth/session';
import { fuentesPropuestasCompartidas } from '@/lib/sport/explorar/cache-real';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { cargarInicio } from '@/lib/sport/explorar/inicio-pantalla';
import { construirUrlInicio } from '@/lib/sport/explorar/inicio-url';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { contextoReal } from '@/lib/sport/explorar/real';
import { cargarConteoSiguiendo, LIMITE_FEED } from '@/lib/sport/explorar/siguiendo-pantalla';
import { leerCriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import { construirUrlBuscar, esBusqueda, leerCriterios } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';
export const metadata = { title: NOMBRE_SECCION };

/** El número de personas seguidas, en diferido: no retrasa los resultados. */
async function ConteoSiguiendo({ ctx }: { ctx: ContextoExplorador }) {
  return <EnlaceSiguiendo siguiendo={await cargarConteoSiguiendo(ctx)} />;
}

/**
 * «Para ti», el primer ámbito de Explorar: el campo de búsqueda, el selector
 * de ámbitos, Siguiendo con su número, Todo / Medallas y los últimos
 * resultados de las personas que sigue la cuenta (de la URL sólo se leen el
 * filtro de medallas y el cursor, ligado a la cuenta). Sin nadie a quien
 * seguir, sugerencias y atajos a Torneos y Países.
 *
 * `/explorar?q=…` (o cualquier criterio de búsqueda) es un enlace antiguo de
 * Tiradores: redirige a `/explorar/buscar` con la misma consulta.
 *
 * La guarda de sesión va aquí además de en el layout: un layout no se vuelve a
 * ejecutar al navegar entre páginas hermanas, y esta página lee datos
 * deportivos. Nada aquí llama a una fuente externa.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const params = await searchParams;
  if (esBusqueda(params)) {
    const { criterios, cursor } = leerCriterios(params);
    redirect(construirUrlBuscar(criterios, cursor));
  }

  const ctx = contextoReal();
  const criterios = leerCriteriosSiguiendo(params);
  const { vista, siguiendo } = await cargarInicio(ctx, {
    cursor: criterios.cursor || undefined,
    soloMedallas: criterios.soloMedallas,
  }, fuentesPropuestasCompartidas(ctx));
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  const enlace = siguiendo !== null ? (
    <EnlaceSiguiendo siguiendo={siguiendo} />
  ) : (
    // Sin esqueleto: el enlace se pinta ya y el número llega cuando llega.
    <Suspense fallback={<EnlaceSiguiendo />}>
      <ConteoSiguiendo ctx={ctx} />
    </Suspense>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 lg:mx-auto lg:max-w-2xl">
      <BuscadorInicio profileId={perfil.profileId}>
        <TransicionContenido clave="inicio" nombre="explorar-contenido">
          <div className="flex min-w-0 flex-col gap-2">
            <CabeceraInicio criterios={criterios} enlace={enlace} conFiltro={siguiendo !== 0} />
            {vista.tipo === 'ok' && !vista.sinResultados ? (
              <FeedSiguiendo
                key={construirUrlInicio(criterios)}
                items={vista.items}
                siguiente={vista.siguiente}
                criterios={criterios}
                limite={LIMITE_FEED}
              />
            ) : (
              <EstadoSiguiendo vista={vista} criterios={criterios} siguiendo={siguiendo} />
            )}
          </div>
        </TransicionContenido>
      </BuscadorInicio>
    </div>
  );
}
