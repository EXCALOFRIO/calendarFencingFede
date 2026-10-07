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
  icono?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
};

export function clasesChip(marcado: boolean): string {
  return cn(
    'inline-flex h-[32px] shrink-0 items-center gap-[6px] rounded-full px-[12px] text-[13px] font-medium whitespace-nowrap select-none',
    '[&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 disabled:pointer-events-none disabled:text-off',
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
        <span className="cifra -my-px text-[14px] tabular-nums">{contador}</span>
      ) : null}
      {tipo === 'menu' ? <ChevronDown aria-hidden /> : null}
      {tipo === 'quitar' ? <X aria-hidden /> : null}
    </button>
  );
}

/**
 * Fila de chips. Por defecto se desplaza en horizontal sin barra, a sangre
 * hasta el borde de la pantalla (los `-mx`/`px` deshacen el margen del
 * contenedor); con `envolver` salta de línea.
 */
export function FilaChips({
  etiqueta,
  envolver = false,
  className,
  children,
}: {
  etiqueta: string;
  envolver?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      data-slot="sistema-fila-chips"
      className={cn(
        'flex gap-[8px]',
        envolver
          ? 'flex-wrap'
          : 'no-scrollbar -mx-[16px] -my-[6px] snap-x overflow-x-auto overscroll-x-contain px-[16px] py-[6px] scroll-px-[16px] [&>*]:snap-start',
        className,
      )}
    >
      {children}
    </div>
  );
}
