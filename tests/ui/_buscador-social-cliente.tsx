/**
 * Entrada de navegador de `buscador-social.mts`: monta el formulario real de
 * Explorar (barra social, recientes, filtros) sobre el contenido que el
 * servidor de capturas ya pintó con los componentes de la página.
 */
import { createRoot } from 'react-dom/client';
import { FormularioFiltros } from '@/components/explorar/formulario-filtros';
import type { CriteriosExplorar, OpcionTemporada } from '@/lib/sport/explorar/url';

type Datos = {
  criterios: CriteriosExplorar;
  temporadas: OpcionTemporada[];
  atajoEspana: boolean;
  profileId: string;
  contenido: string;
};

const datos = (window as unknown as { __DATOS: Datos }).__DATOS;
const raiz = document.getElementById('formulario-explorar');
if (raiz) {
  createRoot(raiz).render(
    <FormularioFiltros
      criterios={datos.criterios}
      temporadas={datos.temporadas}
      atajoEspana={datos.atajoEspana}
      profileId={datos.profileId}
    >
      <div className="flex min-w-0 flex-col gap-6" dangerouslySetInnerHTML={{ __html: datos.contenido }} />
    </FormularioFiltros>,
  );
}
