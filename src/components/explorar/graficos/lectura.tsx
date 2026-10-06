'use client';

import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * Línea de lectura bajo una gráfica: al pasar el ratón o tocar un elemento con
 * `data-lectura`, enseña su texto. Un solo manejador delegado para toda la
 * gráfica (no uno por punto) y nada más que un `useState`: el SVG y los puntos
 * siguen llegando pintados del servidor, y sin JavaScript se ve `inicial`.
 */
export function Lectura({
  children,
  inicial,
  className,
}: {
  children: ReactNode;
  /** Lo que se lee antes de tocar nada (p. ej. el último dato). */
  inicial?: string | null;
  className?: string;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const leer = (e: SyntheticEvent) => {
    const el = (e.target as Element | null)?.closest?.('[data-lectura]');
    if (el && e.currentTarget.contains(el)) setTexto(el.getAttribute('data-lectura'));
  };
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      onPointerOver={leer}
      onClick={leer}
      // En táctil el puntero «sale» justo después de tocar: sólo el ratón borra la lectura.
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setTexto(null);
      }}
    >
      {children}
      <p aria-live="polite" className="min-h-4 truncate text-xs leading-4 text-muted-foreground">
        {texto ?? inicial ?? '\u00a0'}
      </p>
    </div>
  );
}
