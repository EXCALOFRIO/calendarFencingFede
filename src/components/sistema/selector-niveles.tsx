'use client';

import * as React from 'react';
import type { FilaNivel } from '@/lib/sport/selector-pruebas';
import { cn } from '@/lib/utils';
import { SelectorSegmentado } from './selector-segmentado';

/**
 * Las filas de `filasSelectorPruebas` (arma, género, modalidad, categoría),
 * una debajo de otra, cada una un `SelectorSegmentado` compacto con el nombre
 * de la dimensión como nombre accesible.
 *
 * Con `onSeleccion` cada toque devuelve el `destinoId`; sin él, y si las
 * opciones traen `destinoHref`, son enlaces que sustituyen la entrada del
 * historial y conservan el desplazamiento.
 */
export function SelectorNiveles({
  filas,
  onSeleccion,
  variante = 'pastilla',
  replace = true,
  scroll = false,
  className,
}: {
  filas: readonly FilaNivel[];
  onSeleccion?: (destinoId: string) => void;
  variante?: 'pastilla' | 'subrayado';
  replace?: boolean;
  scroll?: boolean;
  className?: string;
}) {
  if (filas.length === 0) return null;
  return (
    <div data-slot="sistema-selector-niveles" className={cn('flex min-w-0 flex-col gap-2', className)}>
      {filas.map((fila) => {
        const activa = fila.opciones.find((o) => o.activa)?.valor;
        const destinos = new Map(fila.opciones.map((o) => [o.valor, o.destinoId]));
        return (
          <SelectorSegmentado
            key={fila.dimension}
            etiqueta={fila.etiqueta}
            valor={activa}
            variante={variante}
            tamano="sm"
            anchoMinimo={fila.dimension === 'categoria' ? 4 : 5}
            replace={replace}
            scroll={scroll}
            opciones={fila.opciones.map((o) => ({
              valor: o.valor,
              etiqueta: o.etiqueta,
              ...(onSeleccion ? {} : o.destinoHref !== undefined ? { href: o.destinoHref } : {}),
            }))}
            onCambio={
              onSeleccion || fila.opciones.some((o) => o.destinoHref === undefined)
                ? (valor) => {
                    const id = destinos.get(valor);
                    if (id) onSeleccion?.(id);
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
