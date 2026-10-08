import { CircleAlert, Inbox } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Lo que se pinta cuando una lista no tiene nada (`vacio`) o no se ha podido
 * cargar (`error`). Un icono, un título corto, como mucho una frase y, si
 * tiene sentido, una acción («Quitar filtros», «Reintentar»).
 */
export function EstadoVacio({
  tipo = 'vacio',
  titulo,
  descripcion,
  accion,
  icono,
  className,
}: {
  tipo?: 'vacio' | 'error';
  titulo: React.ReactNode;
  descripcion?: React.ReactNode;
  accion?: React.ReactNode;
  icono?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  className?: string;
}) {
  const Icono = icono ?? (tipo === 'error' ? CircleAlert : Inbox);
  return (
    <div
      data-slot="sistema-estado-vacio"
      data-tipo={tipo}
      role={tipo === 'error' ? 'alert' : 'status'}
      className={cn('flex flex-col items-center gap-3 px-4 py-8 text-center', className)}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex size-12 items-center justify-center rounded-full bg-secondary [&_svg]:size-6',
          tipo === 'error' ? 'text-danger' : 'text-muted-foreground',
        )}
      >
        <Icono aria-hidden />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-base font-semibold text-foreground">{titulo}</p>
        {descripcion ? <p className="text-sm text-muted-foreground">{descripcion}</p> : null}
      </div>
      {accion ? <div className="flex flex-wrap items-center justify-center gap-2">{accion}</div> : null}
    </div>
  );
}
