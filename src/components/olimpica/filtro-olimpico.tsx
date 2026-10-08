'use client';

import { ChipFiltro } from '@/components/sistema/chip-filtro';
import { cn } from '@/lib/utils';
import { IconoAros } from './icono-aros';

/** Chip «Solo JJOO» para los filtros del ranking internacional. */
export function FiltroOlimpico({
  activo,
  onCambio,
  cuantos,
  className,
}: {
  activo: boolean;
  onCambio: (activo: boolean) => void;
  /** Filas que quedarían con el filtro (clasificados + cerca + pendientes). */
  cuantos?: number;
  className?: string;
}) {
  return (
    <ChipFiltro
      marcado={activo}
      onClick={() => onCambio(!activo)}
      contador={cuantos}
      // Detrás de lo visible: el nombre accesible empieza por «Solo JJOO» (WCAG 2.5.3).
      detalle="(LA 2028)"
      icono={IconoAros}
      data-filtro-olimpico=""
      // Los aros son el doble de anchos que de altos: el cuadrado de icono del chip los encogería.
      className={cn('[&_svg]:h-auto! [&_svg]:w-5!', className)}
    >
      Solo JJOO
    </ChipFiltro>
  );
}
