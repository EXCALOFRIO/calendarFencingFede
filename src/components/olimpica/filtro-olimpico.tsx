'use client';

import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { IconoAros } from './icono-aros';

/** Pastilla «Solo JJOO» para los filtros del ranking internacional. */
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
    <Toggle
      variant="outline"
      size="sm"
      pressed={activo}
      onPressedChange={onCambio}
      data-filtro-olimpico=""
      className={cn('rounded-full px-3', className)}
    >
      <IconoAros className="w-[1.375rem]" />
      <span>Solo JJOO</span>
      {cuantos !== undefined ? (
        // Hereda el color del rótulo: un gris propio no llega a 4,5:1 sobre el chip marcado.
        <span className="cifra -my-px text-[14px] tabular-nums">{cuantos}</span>
      ) : null}
      {/* Detrás de lo visible: el nombre accesible empieza por «Solo JJOO» (WCAG 2.5.3). */}
      <span className="sr-only"> (LA 2028)</span>
    </Toggle>
  );
}
