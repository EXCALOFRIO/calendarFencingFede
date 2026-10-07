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
    <span
      {...(decorativa ? { 'aria-hidden': true } : { role: 'img', 'aria-label': etiquetaAccesible(anotacion) })}
      data-olimpica={anotacion.estado}
      data-color-olimpico={color}
      className={cn(
        // En px: con la raíz de 18 px del móvil una medida en rem la agrandaría.
        'inline-flex h-[20px] shrink-0 items-center gap-[4px] rounded-full px-[6px] text-[12px] font-semibold leading-none tabular-nums',
        CLASES_COLOR_OLIMPICO[color],
        // Por debajo de 360 px la fila de /ranking le deja 16 px junto a los puntos.
        compacta && 'max-[359px]:h-4 max-[359px]:w-4 max-[359px]:justify-center max-[359px]:rounded-[3px] max-[359px]:px-0',
        compacta && RELLENO_COMPACTO[color],
        className,
      )}
    >
      <IconoAros apagados={color === 'gris'} className={compacta ? 'max-[359px]:w-[0.875rem]' : undefined} />
      {faltan !== null ? (
        <span aria-hidden className={compacta ? 'max-[359px]:hidden' : undefined}>{`−${puntos(faltan)}`}</span>
      ) : null}
    </span>
  );
}
