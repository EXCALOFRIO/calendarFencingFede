import { redirect } from 'next/navigation';
import { FormularioFiltros } from '@/components/explorar/formulario-filtros';
import {
  ChipsActivos,
  EstadoSinCoincidencias,
  EstadoSinLista,
  ListaDeportistas,
} from '@/components/explorar/resultados';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';
import { construirUrl, leerCriterios, temporadasOfrecidas } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Explorar' };

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
  const vista = await cargarExplorar(contextoReal(), criterios, cursor);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  const atajoEspana = perfil.role === 'coach' || perfil.role === 'admin';
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Explorar</h1>
        <p className="text-sm text-muted-foreground">
          Deportistas de todas las federaciones, con o sin cuenta, activos o retirados.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <FormularioFiltros
          key={construirUrl(criterios, cursor)}
          criterios={criterios}
          temporadas={temporadasOfrecidas(hoy)}
          atajoEspana={atajoEspana}
        />
        <ChipsActivos criterios={criterios} />
      </div>

      {vista.tipo === 'ok' ? (
        vista.sinResultados ? (
          <EstadoSinCoincidencias criterios={criterios} />
        ) : (
          <ListaDeportistas
            items={vista.items}
            siguiente={vista.siguiente}
            cursorActual={cursor}
            criterios={criterios}
          />
        )
      ) : (
        <EstadoSinLista vista={vista} criterios={criterios} />
      )}
    </div>
  );
}
