import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { VistaCalendario } from '@/components/calendario/vista';

/**
 * Cliente del arnés `ola2b-calendario.mts`: monta el calendario de verdad
 * (con sus hojas, la ficha como subpantalla y la Transition del cambio de
 * mes) con los datos que deja el servidor en `window.__DATOS__`.
 */
type Datos = Omit<React.ComponentProps<typeof VistaCalendario>, 'solicitarInscripcion' | 'cargarPasado' | 'cargarInscritos'>;

const datos = (window as unknown as { __DATOS__: Datos }).__DATOS__;
const sinServidor = async () => {
  throw new Error('sin servidor');
};

createRoot(document.getElementById('raiz')!).render(
  <VistaCalendario
    {...datos}
    solicitarInscripcion={sinServidor as never}
    cargarPasado={sinServidor as never}
    cargarInscritos={async () => ({ oficiales: [], estados: {}, pendientes: [] }) as never}
  />,
);
