'use client';

import { useState, type ReactNode } from 'react';
import { SelectorSegmentado, type VarianteSegmento } from '@/components/sistema/selector-segmentado';
import { cn } from '@/lib/utils';

export type OpcionPanel = { valor: string; etiqueta: string; cuenta?: number };

/**
 * Un selector segmentado y, debajo, sólo el panel elegido. Los paneles
 * llegan ya pintados del servidor, pero al DOM sólo entra el activo: con
 * los tres montados y ocultos por CSS (como antes, con radios) la sección de
 * Estadísticas triplicaba sus nodos y el móvil tardaba en maquetarla.
 * Cambiar de panel no vuelve a pedir nada y funde con `opacity`.
 */
export function Paneles({
  etiqueta,
  opciones,
  paneles,
  inicial,
  variante,
  tamano = 'sm',
  anchoMinimo = 6,
  className,
  clasePanel = 'gap-6',
}: {
  /** Nombre accesible del selector («Ámbito»). */
  etiqueta: string;
  opciones: readonly OpcionPanel[];
  paneles: Readonly<Record<string, ReactNode>>;
  inicial?: string;
  /** `subrayado` para pestañas de sección; por defecto, pastilla. */
  variante?: VarianteSegmento;
  tamano?: 'sm' | 'md';
  anchoMinimo?: 4 | 5 | 6 | 8;
  className?: string;
  /** Separación y margen del panel activo. */
  clasePanel?: string;
}) {
  const [valor, setValor] = useState(inicial && inicial in paneles ? inicial : opciones[0]?.valor ?? '');
  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      {opciones.length > 1 ? (
        <SelectorSegmentado
          etiqueta={etiqueta}
          variante={variante}
          tamano={tamano}
          anchoMinimo={anchoMinimo}
          valor={valor}
          onCambio={setValor}
          opciones={opciones}
        />
      ) : null}
      <div key={valor} data-panel={valor} className={cn('sis-aparecer flex min-w-0 flex-col', clasePanel)}>
        {paneles[valor]}
      </div>
    </div>
  );
}
