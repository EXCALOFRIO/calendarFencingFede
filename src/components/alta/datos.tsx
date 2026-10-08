import type * as React from 'react';
import { ListaDatos, ParDato, type Disposicion } from '@/components/sistema/lista-datos';

/** Pares rótulo–valor del alta, sobre `ListaDatos`: el rótulo siempre antes que el valor. */
export function Datos({
  datos,
  disposicion = 'rejilla',
}: {
  datos: [string, React.ReactNode][];
  disposicion?: Disposicion;
}) {
  return (
    <ListaDatos disposicion={disposicion}>
      {datos.map(([etiqueta, valor]) => (
        <ParDato key={etiqueta} etiqueta={etiqueta}>
          {valor}
        </ParDato>
      ))}
    </ListaDatos>
  );
}
