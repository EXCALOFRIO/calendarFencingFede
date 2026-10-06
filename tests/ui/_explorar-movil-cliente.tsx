/**
 * Entrada de navegador de `explorar-movil.mts`: monta las barras de la app
 * (escritorio y móvil) y, en /explorar, el formulario real con la lista
 * completa como componente vivo («Ver más» incluido) o el contenido que el
 * servidor de capturas ya pintó.
 */
import { createRoot } from 'react-dom/client';
import { FormularioFiltros } from '@/components/explorar/formulario-filtros';
import { ListaDeportistas } from '@/components/explorar/resultados';
import { NavEscritorio, NavMovil } from '@/components/nav';
import type { DeportistaListado } from '@/lib/sport/explorar/pantalla';
import type { CriteriosExplorar, OpcionTemporada } from '@/lib/sport/explorar/url';

type Datos = {
  criterios?: CriteriosExplorar;
  temporadas?: OpcionTemporada[];
  atajoEspana?: boolean;
  profileId?: string;
  contenido?: string;
  cabeza?: string;
  lista?: { items: DeportistaListado[]; siguiente: string | null; cursor?: string };
};

const datos = (window as unknown as { __DATOS: Datos }).__DATOS;

for (const [id, Nav] of [['nav-escritorio', NavEscritorio], ['nav-movil', NavMovil]] as const) {
  const sitio = document.getElementById(id);
  if (sitio) createRoot(sitio).render(<Nav role="coach" />);
}

const raiz = document.getElementById('formulario-explorar');
if (raiz && datos.criterios && datos.temporadas) {
  const criterios = datos.criterios;
  createRoot(raiz).render(
    <FormularioFiltros
      criterios={criterios}
      temporadas={datos.temporadas}
      atajoEspana={Boolean(datos.atajoEspana)}
      profileId={datos.profileId}
    >
      <div className="flex min-w-0 flex-col gap-4">
        {datos.cabeza ? <div className="flex min-w-0 flex-col gap-2" dangerouslySetInnerHTML={{ __html: datos.cabeza }} /> : null}
        {datos.lista ? (
          <ListaDeportistas
            items={datos.lista.items}
            siguiente={datos.lista.siguiente}
            cursorActual={datos.lista.cursor}
            criterios={criterios}
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-4" dangerouslySetInnerHTML={{ __html: datos.contenido ?? '' }} />
        )}
      </div>
    </FormularioFiltros>,
  );
}
