"use client"

import * as React from "react"
import { cn } from "cn"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

/**
 * El velo: lo que dice que el foco se ha movido.
 *
 * Ya estaba puesto —`bg-black/50`— y aun así la auditoría concluyó que no
 * había velo. Tenía razón en el síntoma y no en la causa: el velo oscurecía
 * el calendario, pero **el panel iba con `bg-background`, el mismo color que
 * el lienzo**, así que el ojo no tenía dónde ver el límite y leía todo como
 * una sola superficie. Medido en 1440: panel contra calendario, **1,03:1**.
 *
 * Ahora el velo es `--velo` (65 %) y el panel sube al nivel 3. Los dos
 * cambios van juntos: subir solo el velo habría oscurecido el calendario
 * sin dar un borde, y subir solo el panel habría dejado el fondo compitiendo.
 */
function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-velo data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      {/*
        EL PANEL ES UNA SUPERFICIE DE NIVEL 3, NO UN TROZO DE LIENZO.

        Era `bg-background shadow-lg`, es decir: el color del lienzo (nivel 0)
        y la sombra blanda de Tailwind, `rgb(0 0 0 / 10%)` hacia abajo. Con eso
        el panel no existía como objeto. Lo que se veía en
        `capturas/auditoria/aud-6.png` es exactamente la consecuencia: las
        barras del calendario **se cortaban a mitad de palabra** en el borde
        izquierdo y el texto de la ficha parecía escrito sobre el mes.

        Tres cosas, y ninguna sobra:

        - `cristal-panel`: `--popover` al 86 % con desenfoque (sólido sin
          soporte o con transparencia reducida). Más claro que el lienzo
          velado, que es la regla del modo oscuro.
        - el canto de luz del cristal (`--cristal-borde`), la línea de un
          píxel que dice dónde empieza el panel.
        - La sombra **dirigida hacia el contenido que tapa** y dura: negro al
          70 % y 30 px de radio. Una sombra hacia abajo no separa dos cosas
          que están una al lado de la otra.

        Y `overscroll-contain`, que no es estética: sin él, al llegar al final
        de una ficha larga en el móvil el gesto seguía desplazando el
        calendario de detrás.
      */}
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "cristal-panel fixed z-50 flex flex-col gap-4 overscroll-contain data-[state=closed]:animate-out data-[state=open]:animate-in",
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 border-l shadow-[var(--sombra-hoja-der)] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 border-r shadow-[var(--sombra-hoja-izq)] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b shadow-[var(--sombra-hoja-arr)] data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t shadow-[var(--sombra-hoja-aba)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className
        )}
        {...props}
      >
        {children}
        {/*
          EL ASPA: un disco de verdad, y con área de clic.

          Tenía `bg-background/70`, o sea el color del lienzo con alfa, encima
          de un panel que también era `bg-background`: el disco era del mismo
          color que lo que tenía detrás y el resultado era el que describe la
          auditoría, «una ✕ diminuta sin fondo». Medida: **36 × 36 px** en el
          escritorio y **41 × 44** en el iPhone, porque la regla
          `.cerrar-hoja { width: 44px }` de `globals.css` perdía contra
          `size-9`.

          Ahora:
          - el disco es un **control de nivel 2+** (`bg-accent`), sólido: sobre
            el panel queda 0,045 de L por encima, así que se lee como un botón
            que sobresale, y sobre el cartel de la FIE sigue siendo una mancha
            oscura con el aspa blanca a 12,85:1, que es para lo que se puso;
          - el canto de luz al 12 % lo separa también de una foto oscura;
          - el `hover` invierte a blanco en vez de bajar la opacidad, que es
            el mismo recurso que ya usa el `Tooltip`;
          - `size-10` (40 px) y la regla de `globals.css` pasada a
            `min-width`, que sí gana: 44 × 44 con el dedo.
        */}
        {showCloseButton && (
          <SheetPrimitive.Close className="cerrar-hoja absolute top-3 right-3 grid size-10 place-items-center rounded-full border border-filete-alto bg-accent text-foreground transition-colors hover:bg-foreground hover:text-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4.5" />
            <span className="sr-only">Cerrar</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
