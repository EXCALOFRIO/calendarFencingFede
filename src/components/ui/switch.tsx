"use client"

import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

/*
 * La caja que recibe el toque es el propio botón, de 44 px, y el dibujo
 * (36 × 20, o 28 × 16 en `sm`) va dentro. Con un `::after` la sonda de la
 * matriz de dispositivos, que mide `getBoundingClientRect`, no lo vería.
 */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex h-[44px] min-w-[44px] shrink-0 items-center justify-center outline-none select-none [-webkit-tap-highlight-color:transparent] disabled:cursor-not-allowed",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        data-slot="switch-track"
        className={cn(
          "flex items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none",
          "group-data-[size=default]/switch:h-5 group-data-[size=default]/switch:w-9 group-data-[size=sm]/switch:h-4 group-data-[size=sm]/switch:w-7",
          "group-data-[state=checked]/switch:border-transparent group-data-[state=checked]/switch:bg-primary group-data-[state=unchecked]/switch:border-filete-alto group-data-[state=unchecked]/switch:bg-secondary",
          "group-disabled/switch:group-data-[state=checked]/switch:bg-muted",
          "group-focus-visible/switch:ring-2 group-focus-visible/switch:ring-ring group-focus-visible/switch:ring-offset-2 group-focus-visible/switch:ring-offset-background"
        )}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            "pointer-events-none block translate-x-px rounded-full bg-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
            "group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3",
            "data-[state=checked]:bg-primary-foreground group-data-[size=default]/switch:data-[state=checked]:translate-x-[17px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[13px]",
            "group-disabled/switch:bg-off"
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
