import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"
import { AREA_TACTIL } from "@/components/sistema/tactil"

/*
 * Se ve de 28-40 px (en px, no en rem: en el móvil la raíz son 18 px) y se
 * toca en 44: el área sobrante es el `::after` invisible de `AREA_TACTIL`,
 * que también cubre `asChild` con un enlace (la regla global de
 * `globals.css` sólo alcanza a `button` y `a[role=button]`).
 */
const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    AREA_TACTIL,
  ),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-110",
        destructive:
          "bg-destructive text-white hover:brightness-110 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-input bg-secondary shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[36px] px-4 has-[>svg]:px-3",
        xs: "h-[28px] gap-1 rounded-md px-2 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[32px] gap-2 rounded-md px-3 text-sm has-[>svg]:px-3",
        lg: "h-[40px] rounded-md px-5 has-[>svg]:px-4",
        icon: "size-[36px]",
        "icon-xs": "size-[28px] rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[32px]",
        "icon-lg": "size-[40px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
