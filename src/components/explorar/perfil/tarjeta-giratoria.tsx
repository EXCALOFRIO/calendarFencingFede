'use client';

import { useState, type ReactNode } from 'react';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';

export type CaraTarjeta = { clave: string; rotulo: string; contenido: ReactNode };

/**
 * Tarjeta de cifras con varias caras (General, Internacional, Nacional) y un
 * selector segmentado encima. Sólo la cara elegida está en el DOM y entra
 * con un fundido de `opacity` (`.sis-aparecer`; nada con movimiento
 * reducido). Antes giraba en 3D con las dos caras montadas: más nodos, una
 * capa de composición por cara y 700 ms de animación.
 *
 * Sin JavaScript se ve la primera cara (o `inicial`) y nada más.
 */
export function TarjetaGiratoria({
  caras,
  etiqueta,
  inicial = 0,
}: {
  caras: readonly CaraTarjeta[];
  etiqueta: string;
  /** Índice de la cara con la que se abre. */
  inicial?: number;
}) {
  const primera = Math.min(Math.max(0, inicial), caras.length - 1);
  const [clave, setClave] = useState(caras[primera]?.clave ?? '');
  const visible = caras.find((c) => c.clave === clave) ?? caras[primera];

  if (caras.length === 1) return <div className="min-w-0">{caras[0].contenido}</div>;

  return (
    <section aria-label={etiqueta} className="flex min-w-0 flex-col gap-3">
      <SelectorSegmentado
        etiqueta="Qué cifras ver"
        tamano="sm"
        anchoMinimo={6}
        valor={visible.clave}
        onCambio={setClave}
        opciones={caras.map((c) => ({ valor: c.clave, etiqueta: c.rotulo }))}
      />
      <div key={visible.clave} data-cara={visible.clave} className="sis-aparecer min-w-0">
        {visible.contenido}
      </div>
    </section>
  );
}
