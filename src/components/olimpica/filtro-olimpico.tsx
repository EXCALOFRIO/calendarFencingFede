'use client';

import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { IconoLaurel } from './icono-laurel';

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
      aria-label="Solo JJOO LA 2028"
      data-filtro-olimpico=""
      className={cn('rounded-full px-3', className)}
    >
      <IconoLaurel />
      <span>Solo JJOO</span>
      {cuantos !== undefined ? (
        <span className="text-xs text-muted-foreground tabular-nums">{cuantos}</span>
      ) : null}
    </Toggle>
  );
}
