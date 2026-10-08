import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { AREA_TACTIL, FOCO, PULSACION, SIN_MINIMO } from './tactil';

/*
 * Ninguna variante usa alfa en la superficie: el `hover` cambia de token
 * (`secondary` → `accent`) o de brillo, nunca a `bg-x/90`, que deja ver lo
 * de detrás y cambia de color según el fondo.
 */
const variantesBoton = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none',
    'disabled:pointer-events-none aria-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
    SIN_MINIMO,
    AREA_TACTIL,
    FOCO,
    PULSACION,
  ),
  {
    variants: {
      variante: {
        primario: 'bg-primary text-primary-foreground hover:brightness-110 disabled:bg-muted disabled:text-off',
        secundario: 'bg-secondary text-foreground hover:bg-accent disabled:text-off',
        claro: 'bg-foreground text-background hover:brightness-90 disabled:bg-muted disabled:text-off',
        contorno: 'border border-filete-alto bg-transparent text-foreground hover:bg-accent disabled:text-off',
        fantasma: 'bg-transparent text-foreground hover:bg-accent disabled:text-off',
      },
      tamano: {
        sm: 'h-[28px] gap-1 px-3 text-xs [&_svg]:size-[14px]',
        md: 'h-[32px] px-3 text-sm [&_svg]:size-[16px]',
        lg: 'h-[36px] px-4 text-sm [&_svg]:size-[18px]',
      },
      ancho: {
        natural: '',
        completo: 'w-full',
      },
    },
    defaultVariants: { variante: 'secundario', tamano: 'md', ancho: 'natural' },
  },
);

export type PropsBoton = React.ComponentProps<'button'> &
  VariantProps<typeof variantesBoton> & {
    /** Pinta el hijo (un `Link`, por ejemplo) con el aspecto del botón. */
    asChild?: boolean;
  };

export function Boton({ className, variante, tamano, ancho, asChild = false, type, ...props }: PropsBoton) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="sistema-boton"
      data-variante={variante ?? 'secundario'}
      data-tamano={tamano ?? 'md'}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(variantesBoton({ variante, tamano, ancho }), className)}
      {...props}
    />
  );
}

const variantesIcono = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center rounded-full select-none',
    'disabled:pointer-events-none disabled:text-off [&_svg]:pointer-events-none [&_svg]:shrink-0',
    SIN_MINIMO,
    AREA_TACTIL,
    FOCO,
    PULSACION,
  ),
  {
    variants: {
      variante: {
        fantasma: 'text-foreground hover:bg-accent',
        secundario: 'bg-secondary text-foreground hover:bg-accent',
        primario: 'bg-primary text-primary-foreground hover:brightness-110',
      },
      tamano: {
        sm: 'size-[28px] [&_svg]:size-[18px]',
        md: 'size-[32px] [&_svg]:size-[20px]',
        lg: 'size-[36px] [&_svg]:size-[20px]',
      },
    },
    defaultVariants: { variante: 'fantasma', tamano: 'lg' },
  },
);

export type PropsBotonIcono = Omit<React.ComponentProps<'button'>, 'aria-label'> &
  VariantProps<typeof variantesIcono> & {
    /** Obligatoria: un botón de sólo icono no tiene otro nombre accesible. */
    etiqueta: string;
    asChild?: boolean;
  };

export function BotonIcono({ className, variante, tamano, etiqueta, asChild = false, type, ...props }: PropsBotonIcono) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="sistema-boton-icono"
      aria-label={etiqueta}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(variantesIcono({ variante, tamano }), className)}
      {...props}
    />
  );
}

export { variantesBoton, variantesIcono };
