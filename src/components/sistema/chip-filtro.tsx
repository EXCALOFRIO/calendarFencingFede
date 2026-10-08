import { ChevronDown, X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { AREA_TACTIL, FOCO, PULSACION, SIN_MINIMO } from './tactil';

export type PropsChipFiltro = Omit<React.ComponentProps<'button'>, 'children'> & {
  children: React.ReactNode;
  /**
   * - `alternar`: activa o desactiva un valor; lleva `aria-pressed`.
   * - `menu`: abre una hoja con opciones; lleva flecha y `aria-haspopup`.
   * - `quitar`: un filtro ya puesto que se quita con un toque; lleva aspa.
   */
  tipo?: 'alternar' | 'menu' | 'quitar';
  /** Marcado: relleno claro y texto oscuro, el mismo en toda la aplicación. */
  marcado?: boolean;
  /** Cifra al lado del rótulo, por ejemplo cuántos filtros hay puestos. */
  contador?: number;
  /**
   * Lo que el lector oye detrás de la cifra («de 907»). En vez de un
   * `aria-label`, que tendría que repetir lo visible letra a letra (WCAG 2.5.3).
   */
  detalle?: string;
  icono?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
};

export function clasesChip(marcado: boolean): string {
  return cn(
    'inline-flex h-[32px] max-w-full shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium whitespace-nowrap select-none',
    '[&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 disabled:pointer-events-none disabled:text-off',
    // Un rótulo largo se recorta con «…» en vez de desbordar la fila en un móvil estrecho.
    '[&>span]:min-w-0 [&>span]:truncate',
    SIN_MINIMO,
    AREA_TACTIL,
    FOCO,
    PULSACION,
    marcado
      ? 'bg-foreground text-background'
      : // Dentro de una hoja (nivel 3) el gris de control casi no se separa del panel.
        'bg-secondary text-foreground hover:bg-accent in-data-[slot=sistema-hoja]:bg-accent in-data-[slot=sistema-hoja]:hover:brightness-110',
  );
}

export function ChipFiltro({
  children,
  tipo = 'alternar',
  marcado = tipo === 'quitar',
  contador,
  detalle,
  icono: Icono,
  className,
  type,
  ...nativos
}: PropsChipFiltro) {
  const aria =
    tipo === 'alternar'
      ? { 'aria-pressed': marcado }
      : tipo === 'menu'
        ? { 'aria-haspopup': 'dialog' as const }
        : typeof children === 'string'
          ? { 'aria-label': `Quitar ${children}` }
          : {};

  return (
    <button
      type={type ?? 'button'}
      data-slot="sistema-chip"
      data-tipo={tipo}
      data-marcado={marcado || undefined}
      className={cn(clasesChip(marcado), className)}
      {...aria}
      {...nativos}
    >
      {Icono ? <Icono aria-hidden /> : null}
      <span>{children}</span>
      {contador !== undefined && contador > 0 ? (
        <span className="cifra -my-px text-sm tabular-nums">{contador}</span>
      ) : null}
      {detalle ? <span className="sr-only"> {detalle}</span> : null}
      {tipo === 'menu' ? <ChevronDown aria-hidden /> : null}
      {tipo === 'quitar' ? <X aria-hidden /> : null}
    </button>
  );
}

/**
 * Fila de chips. Salta de línea cuando no caben: nada en la aplicación se
 * desplaza en horizontal, porque en un móvil de 360 px los chips escondidos
 * a la derecha no se descubren. El hueco vertical (12 px) más el chip (32 px)
 * suman los 44 px del área táctil, así que las áreas de dos filas no se pisan.
 */
export function FilaChips({
  etiqueta,
  className,
  children,
}: {
  etiqueta: string;
  /** @deprecated La fila siempre salta de línea; se acepta para no romper a quien lo pasa. */
  envolver?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      data-slot="sistema-fila-chips"
      className={cn('flex min-w-0 flex-wrap gap-x-2 gap-y-3', className)}
    >
      {children}
    </div>
  );
}
