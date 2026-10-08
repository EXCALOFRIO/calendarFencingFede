import { Pastilla } from '@/components/sistema/pastilla';
import { colorOlimpico, type AnotacionOlimpica, type ColorOlimpico } from '@/lib/ranking/olimpica';
import { cn } from '@/lib/utils';
import { IconoAros } from './icono-aros';
import { etiquetaAccesible, puntos } from './textos';

/**
 * Tintes opacos (`docs/diseno-sistema.md` § 3 y § 9): el color del estado
 * mezclado con `--card`, como `--warn-tinte` y los `--org-*-tinte`, y sin
 * borde. Un alfa dejaría ver lo que hay detrás (la retícula, una fila marcada).
 */
export const CLASES_COLOR_OLIMPICO: Record<ColorOlimpico, string> = {
  verde: 'bg-[color-mix(in_oklab,var(--ok)_16%,var(--card))] text-ok',
  amarillo: 'bg-warn-tinte text-warn',
  gris: 'bg-[color-mix(in_oklab,var(--off)_18%,var(--card))] text-muted-foreground',
};

// La baldosa compacta es tan pequeña que necesita más tinte para que el color se lea.
const RELLENO_COMPACTO: Record<ColorOlimpico, string> = {
  verde: 'max-[359px]:bg-[color-mix(in_oklab,var(--ok)_30%,var(--card))]',
  amarillo: 'max-[359px]:bg-[color-mix(in_oklab,var(--warn)_30%,var(--card))]',
  gris: 'max-[359px]:bg-[color-mix(in_oklab,var(--off)_30%,var(--card))]',
};

/**
 * La etiqueta olímpica sin interacción: los aros, en el color del estado (ver
 * `colorOlimpico`; el icono usa `currentColor`, así que lo toma de `text-*`).
 * En amarillo lleva además los puntos que faltan; en gris los aros van
 * apagados, para que no dependa sólo del color. Sin color no se pinta nada.
 */
export function PastillaOlimpica({
  anotacion,
  compacta = false,
  decorativa = false,
  className,
}: {
  anotacion: AnotacionOlimpica | null | undefined;
  /** Por debajo de 360 px, una baldosa de 16 px con los aros: sin los puntos, pero con el color. */
  compacta?: boolean;
  /** Dentro de un botón que ya lleva la etiqueta accesible. */
  decorativa?: boolean;
  className?: string;
}) {
  const color = colorOlimpico(anotacion);
  if (!anotacion || !color) return null;
  const faltan = anotacion.estado === 'cerca' ? anotacion.faltan : null;
  return (
    <Pastilla
      {...(decorativa ? { 'aria-hidden': true } : { role: 'img', 'aria-label': etiquetaAccesible(anotacion) })}
      data-olimpica={anotacion.estado}
      data-color-olimpico={color}
      className={cn(
        // Los aros son el doble de anchos que de altos: no caben en el cuadrado de icono de la pastilla.
        'font-semibold tabular-nums [&_svg]:h-auto [&_svg]:w-5',
        CLASES_COLOR_OLIMPICO[color],
        // Por debajo de 360 px la fila de /ranking le deja 16 px junto a los puntos.
        compacta && 'max-[359px]:h-4 max-[359px]:w-4 max-[359px]:justify-center max-[359px]:rounded-md max-[359px]:px-0 max-[359px]:[&_svg]:w-3.5',
        compacta && RELLENO_COMPACTO[color],
        className,
      )}
    >
      <IconoAros apagados={color === 'gris'} />
      {faltan !== null ? (
        <span aria-hidden className={compacta ? 'max-[359px]:hidden' : undefined}>{`−${puntos(faltan)}`}</span>
      ) : null}
    </Pastilla>
  );
}