/**
 * Entrada de navegador de `explorar-app.mts`: hidrata las barras de la app y
 * el contenido que el servidor de capturas ya pintó con los mismos
 * componentes (Inicio, Buscar o Siguiendo), para que la primera pintura sea
 * la del HTML del servidor y lo vivo (fotos, carga incremental, Seguir,
 * buscador) funcione como en la app.
 */
import { createRoot, hydrateRoot } from 'react-dom/client';
import { contenidoExplorar, type DatosExplorarApp } from './_explorar-app-vista';
import { NavEscritorio, NavMovil } from '@/components/nav';

const datos = (window as unknown as { __DATOS: DatosExplorarApp }).__DATOS;

for (const [id, Nav] of [['nav-escritorio', NavEscritorio], ['nav-movil', NavMovil]] as const) {
  const sitio = document.getElementById(id);
  if (sitio) createRoot(sitio).render(<Nav role="coach" />);
}

// El formulario de Buscar usa el router de Next, que fuera de Next no se puede pintar en el servidor.
const raiz = document.getElementById('isla');
// Competiciones y Países también llevan buscadores con el router: se montan en el navegador.
if (raiz && (datos.vista === 'buscar' || datos.vista === 'ediciones' || datos.vista === 'paises')) createRoot(raiz).render(contenidoExplorar(datos));
else if (raiz && (datos.vista === 'inicio' || datos.vista === 'siguiendo')) hydrateRoot(raiz, contenidoExplorar(datos));
