import { cn } from '@/lib/utils';

/**
 * Controles de las pantallas de notificaciones con la escala del sistema
 * (`docs/diseno-sistema.md` § 2): se VEN de 32 px (pastilla) o 36 px
 * (círculo), pero la caja real que recibe el toque mide 44. No es el
 * `::after` de `AREA_TACTIL`: aquí la caja es el propio botón o enlace, y lo
 * que se dibuja va en un `<span>` dentro. Así lo mide igual cualquier sonda
 * (la matriz de dispositivos mide `getBoundingClientRect`) y no hay un área
 * que un antepasado con `overflow` pueda recortar.
 */
export const CAJA_TACTIL =
  'group inline-flex h-[44px] min-w-[44px] shrink-0 items-center justify-center outline-none select-none [-webkit-tap-highlight-color:transparent] disabled:pointer-events-none';

const DIBUJO =
  'inline-flex items-center justify-center rounded-full transition-[scale,background-color,color] duration-150 ease-out group-active:scale-[0.96] motion-reduce:transition-none group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:shrink-0';

/** Superficies opacas, sin alfa: el `hover` cambia de token o de brillo. */
const VARIANTE = {
  primario: 'bg-primary text-primary-foreground group-hover:brightness-110 group-disabled:bg-muted group-disabled:text-off',
  secundario: 'bg-secondary text-foreground group-hover:bg-accent group-disabled:text-off',
  fantasma: 'text-foreground group-hover:bg-accent group-disabled:text-off',
} as const;

export type VarianteControl = keyof typeof VARIANTE;

/** La pastilla de 32 px de `Boton` md: texto de 14 px semibold e icono de 16. */
export function clasesPastilla(variante: VarianteControl = 'secundario', className?: string): string {
  return cn(DIBUJO, VARIANTE[variante], 'h-[32px] gap-2 px-4 text-sm font-semibold whitespace-nowrap [&_svg]:size-4', className);
}

/** El círculo de 36 px de `BotonIcono` lg, con icono de 20. */
export function clasesCirculo(variante: VarianteControl = 'fantasma', className?: string): string {
  return cn(DIBUJO, VARIANTE[variante], 'relative size-[36px] [&_svg]:size-[20px]', className);
}
