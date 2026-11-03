import { Pastilla } from '@/components/sistema/pastilla';
import { colorOlimpico, type AnotacionOlimpica, type ColorOlimpico } from '@/lib/ranking/olimpica';
import { cn } from '@/lib/utils';
import { IconoAros } from './icono-aros';
import { etiquetaAccesible, textoPastilla } from './textos';

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

/**
 * La etiqueta olímpica sin interacción: los aros, en el color del estado (ver
 * `colorOlimpico`; el icono usa `currentColor`, así que lo toma de `text-*`),
 * **y el estado en texto** (`textoPastilla`): «Clasificado», «A 30 pts»,
 * «Sin decidir». El color nunca es la única señal — era la queja del
 * seleccionador que motivó esta pieza—; en gris los aros van apagados y el
 * texto lo dice igual. Sin color no se pinta nada.
 *
 * Debajo de 360 px con `compacta` se esconden los aros, no el texto: lo que
 * informa es la palabra, y «Clasificado» ya no cabe el nombre del ranking al
 * lado.
 */
export function PastillaOlimpica({
  anotacion,
  compacta = false,
  decorativa = false,
  className,
}: {
  anotacion: AnotacionOlimpica | null | undefined;
  /** Por debajo de 360 px, solo el texto en el color del estado: sin aros. */
  compacta?: boolean;
  /** Dentro de un botón que ya lleva la etiqueta accesible. */
  decorativa?: boolean;
  className?: string;
}) {
  const color = colorOlimpico(anotacion);
  if (!anotacion || !color) return null;
  const texto = textoPastilla(anotacion);
  return (
    <Pastilla
      {...(decorativa ? { 'aria-hidden': true } : { role: 'img', 'aria-label': etiquetaAccesible(anotacion) })}
      data-olimpica={anotacion.estado}
      data-color-olimpico={color}
      className={cn(
        // Los aros son el doble de anchos que de altos: no caben en el cuadrado de icono de la pastilla.
        'font-semibold tabular-nums [&_svg]:h-auto [&_svg]:w-5',
        CLASES_COLOR_OLIMPICO[color],
        // Por debajo de 360 px la fila de /ranking deja poco sitio: el texto es lo que queda.
        compacta && 'max-[359px]:[&_svg]:hidden',
        className,
      )}
    >
      <IconoAros apagados={color === 'gris'} />
      <span aria-hidden>{texto}</span>
    </Pastilla>
  );
}
