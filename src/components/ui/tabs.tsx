"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-card",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        /*
          EL COLOR DE LA PESTAÑA APAGADA, EN UNA SOLA CLASE.

          Traía tres: `text-foreground/60`, `dark:text-muted-foreground` y
          `dark:hover:text-foreground`. Y eso no era solo ruido: `html` lleva
          la clase `dark`, así que `dark:text-muted-foreground` tiene un
          selector más —`:is(.dark *)`— que cualquier `data-[state=active]:`,
          y **le ganaba al color de la pestaña activa**. Medido: activa e
          inactiva salían las dos en `lab(70.96 -0.22 -3.77)`, el mismo gris,
          con el borde y el fondo ya puestos. Se veía la caja y no se veía el
          rótulo.

          Esta aplicación es oscura y punto (`color-scheme: dark` y el tema
          entero en `:root`), así que la variante `dark` aquí no distingue
          nada: sobra y encima estorba.
        */
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        /*
          La pestaña activa, con la misma convención que cualquier otro
          control marcado: contorno rojo, superficie teñida y rótulo en rojo
          y negrita. Antes era `bg-secondary` + `border-input`, o sea un
          escalón de gris de 0,099 de distancia OKLab sobre el track: medido y
          mirado a 4×, no se distinguía de una pestaña apagada. El porqué y
          los números están en `globals.css` («EL CONTROL MARCADO»).

          Va **antes** de las reglas de la variante `line`, que a propósito
          dejan la pestaña activa sin fondo y sin borde porque ahí la señal es
          el subrayado de `after:`. Si fuese después, el tinte se colaría en
          una variante que no lo quiere.
        */
        "data-[state=active]:border-primary-text data-[state=active]:bg-marcado data-[state=active]:font-semibold data-[state=active]:text-primary-text",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
