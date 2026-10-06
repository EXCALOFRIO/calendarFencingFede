import { redirect } from 'next/navigation';
import { CabeceraExplorar } from '@/components/explorar/cabecera-explorar';
import { FormularioFiltros } from '@/components/explorar/formulario-filtros';
import {
  ChipsActivos,
  EstadoSinCoincidencias,
  EstadoSinLista,
  ListaDeportistas,
} from '@/components/explorar/resultados';
import { getSessionProfile } from '@/lib/auth/session';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';
import {
  cargarConteoSiguiendo,
  leerPropuestasParaSeguir,
  type PersonaParaSeguir,
} from '@/lib/sport/explorar/siguiendo-pantalla';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { PropuestasBuscador } from '@/components/explorar/buscador-social-fila';
import { construirUrl, hayCriterios, leerCriterios, opcionesTemporada } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';
export const metadata = { title: NOMBRE_SECCION };

/** Sugerencias de la pantalla vacía; `null` si fallan (la búsqueda sigue funcionando). */
async function cargarPropuestas(ctx: ContextoExplorador): Promise<PersonaParaSeguir[] | null> {
  try {
    return await leerPropuestasParaSeguir(ctx);
  } catch (error) {
    console.error('[explorar] las sugerencias para seguir no se pudieron leer:', error instanceof Error ? error.name : 'desconocido');
    return null;
  }
}

/**
 * Explorar: buscador de deportistas de todas las federaciones.
 *
 * La guarda de sesión va aquí además de en el layout: un layout no se vuelve a
 * ejecutar al navegar entre páginas hermanas, y esta página lee datos
 * deportivos. El atajo «Solo España» es una comodidad del seleccionador y la
 * dirección técnica; no concede nada: el filtro por país está en la URL para
 * cualquier cuenta con sesión y no abre el ranking interno de ningún arma.
 *
 * Todo criterio y el cursor viven en la URL, así que Atrás y los enlaces
 * compartidos reproducen la misma búsqueda. Nada aquí llama a una fuente
 * externa: sólo se lee lo ya indexado en Neon.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const { criterios, cursor } = leerCriterios(await searchParams);
  const ctx = contextoReal();
  const inicio = !hayCriterios(criterios);
  const [vista, siguiendo, propuestas] = await Promise.all([
    cargarExplorar(ctx, criterios, cursor),
    cargarConteoSiguiendo(ctx),
    inicio ? cargarPropuestas(ctx) : Promise.resolve(null),
  ]);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  const atajoEspana = perfil.role === 'coach' || perfil.role === 'admin';
  const hoy = new Date().toISOString().slice(0, 10);

  const contenido = vista.tipo === 'ok' ? (
    vista.sinResultados ? (
      <EstadoSinCoincidencias criterios={criterios} />
    ) : (
      <ListaDeportistas
        key={construirUrl(criterios, cursor)}
        items={vista.items}
        siguiente={vista.siguiente}
        cursorActual={cursor}
        criterios={criterios}
      />
    )
  ) : inicio && vista.tipo === 'sin_criterio' && propuestas?.length !== 0 ? (
    <PropuestasBuscador propuestas={propuestas} className="lg:max-w-2xl" />
  ) : (
    <EstadoSinLista vista={vista} criterios={criterios} />
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CabeceraExplorar siguiendo={siguiendo} />

      <FormularioFiltros
        key={construirUrl(criterios, cursor)}
        criterios={criterios}
        temporadas={opcionesTemporada(hoy)}
        atajoEspana={atajoEspana}
        profileId={perfil.profileId}
      >
        <div className="flex min-w-0 flex-col gap-4">
          {inicio ? null : <ChipsActivos criterios={criterios} />}
          {contenido}
        </div>
      </FormularioFiltros>
    </div>
  );
}
