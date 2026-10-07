/**
 * Entrada de navegador de `sistema-muestra.mts`: hidrata la muestra que el
 * servidor del arnés ya pintó, para comprobar que las piezas hidratan sin
 * diferencias y que la hoja inferior se abre de verdad.
 */
import { hydrateRoot } from 'react-dom/client';
import { Muestra } from './_sistema-muestra-vista';

const datos = (window as unknown as { __DATOS: { hoja: boolean } }).__DATOS;
const raiz = document.getElementById('raiz');
if (raiz) hydrateRoot(raiz, <Muestra hojaInicial={datos.hoja} />);
