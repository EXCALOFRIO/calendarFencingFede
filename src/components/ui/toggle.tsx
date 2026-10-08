"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Toggle as TogglePrimitive } from "radix-ui"

/**
 * EL MARCADO DE UN CONTROL: CONTORNO ROJO, NO RELLENO ROJO.
 *
 * Este `cva` es la fuente única de los catorce `ToggleGroup` del proyecto, así
 * que la convención de `REFERENCIAS.md` § 9.1 vive aquí y en ningún sitio más.
 * El porqué, con las medidas, está en `globals.css` («EL CONTROL MARCADO»).
 *
 * Tres estados y tres aspectos que no se confunden:
 *
 *   marcado      borde `--primary-text` + superficie `--marcado` + rótulo rojo
 *                y **en negrita**
 *   sin marcar   borde `--input` + transparente + rótulo apagado
 *   acción       no es esto: la acción principal es un `Button` relleno
 *
 * Y dos arreglos de bulto que traía la versión de shadcn:
 *
 * 1. `hover:bg-muted hover:text-muted-foreground` **apagaba el rótulo al pasar
 *    el ratón**. Un control responde subiendo de contraste, no bajando.
 * 2. El marcado (`bg-accent`) y el `hover` (`bg-accent`) eran **el mismo
 *    color**, así que un item apagado bajo el ratón se veía igual que el
 *    marcado. Ahora el `hover` es `--accent` y el marcado es `--marcado`, que
 *    es otro sitio de la paleta.
 *
 * El marcado gana al `hover` por especificidad: el selector lleva el atributo
 * además de la clase, así que pasar el ratón por encima de lo ya marcado no
 * le quita el tinte.
 */
const MARCADO =
  "data-[state=on]:border-primary-text data-[state=on]:bg-marcado data-[state=on]:font-semibold data-[state=on]:text-primary-text data-[state=on]:hover:bg-marcado data-[state=on]:hover:text-primary-text"

const toggleVariants = cva(
  `inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,box-shadow] outline-none hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 ${MARCADO}`,
  {
    variants: {
      variant: {
        /* El borde va transparente, no ausente: así el marcado tiene dónde
           pintar su contorno sin que el control cambie de tamaño al
           marcarse. `border-box` se encarga de que el alto no se mueva. */
        default: "border border-transparent bg-transparent",
        outline: "border border-input bg-transparent shadow-xs",
      },
      size: {
        default: "h-9 min-w-9 px-2",
        sm: "h-8 min-w-8 px-2",
        lg: "h-10 min-w-10 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
