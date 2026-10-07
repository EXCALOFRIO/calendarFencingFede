import { redirect } from 'next/navigation';
import { CabeceraInicio, EstadoSiguiendo, FeedSiguiendo } from '@/components/explorar/siguiendo';
import { getSessionProfile } from '@/lib/auth/session';
import { fuentesPropuestasCompartidas } from '@/lib/sport/explorar/cache-real';
import { cargarInicio } from '@/lib/sport/explorar/inicio-pantalla';
import { construirUrlInicio } from '@/lib/sport/explorar/inicio-url';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';
import { LIMITE_FEED } from '@/lib/sport/explorar/siguiendo-pantalla';
import { leerCriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import { esBusqueda, leerCriterios } from '@/lib/sport/explorar/url';
import { PantallaBuscar } from './pantalla-buscar';

export const dynamic = 'force-dynamic';
export const metadata = { title: NOMBRE_SECCION };

/**
 * `/explorar` es dos pantallas según la URL:
 *
 *  - sin búsqueda, **Inicio**: el feed con los últimos resultados de las
 *    personas que sigue la cuenta (de la URL sólo se leen el filtro de
 *    medallas y el cursor, ligado a la cuenta);
 *  - con cualquier criterio de búsqueda (`?q=…`, `?arma=…`), **Buscar** con
 *    la lista completa. Así siguen valiendo los enlaces y los retornos de
 *    ficha de siempre; Buscar sin nada escrito vive en `/explorar/buscar`.
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
  const ctx = contextoReal();

  if (esBusqueda(params)) {
    const { criterios, cursor } = leerCriterios(params);
    const vista = await cargarExplorar(ctx, criterios, cursor);
    if (vista.tipo === 'sin_sesion') redirect('/entrar');
    return <PantallaBuscar perfil={perfil} ctx={ctx} criterios={criterios} cursor={cursor} vista={vista} />;
  }

  const criterios = leerCriteriosSiguiendo(params);
  const { vista, siguiendo } = await cargarInicio(ctx, {
    cursor: criterios.cursor || undefined,
    soloMedallas: criterios.soloMedallas,
  }, fuentesPropuestasCompartidas(ctx));
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  return (
    <div className="flex w-full min-w-0 flex-col gap-1 lg:mx-auto lg:max-w-2xl">
      <CabeceraInicio criterios={criterios} />
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
  );
}
