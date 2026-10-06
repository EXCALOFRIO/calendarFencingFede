import { Check, Clock } from 'lucide-react';
import type { AnotacionOlimpica } from '@/lib/ranking/olimpica';
import { cn } from '@/lib/utils';
import { IconoLaurel } from './icono-laurel';
import { etiquetaAccesible, puntos } from './textos';

// Siempre dorada: es la marca de lo olímpico, no un semáforo. El verde y el
// ámbar son de los plazos y aquí se leían como «a tiempo» o «atención».
const DORADA = 'bg-gold/15 text-gold border-gold/40';

/**
 * Pastilla olímpica de una fila del ranking internacional.
 *
 * El estado lo dice el icono, no el color: clasificado lleva ✓, cerca lleva
 * los puntos que le faltan y pendiente un reloj. Sin estado no se pinta nada.
 */
export function InsigniaOlimpica({
  anotacion,
  compacta = false,
  className,
}: {
  anotacion: AnotacionOlimpica | null | undefined;
  /** Por debajo de 360 px, sólo el laurel: el estado queda en la etiqueta accesible y en la burbuja. */
  compacta?: boolean;
  className?: string;
}) {
  const estado = anotacion?.estado;
  if (!anotacion || !estado) return null;
  const extra = compacta ? 'max-[359px]:hidden' : undefined;
  return (
    <span
      role="img"
      aria-label={etiquetaAccesible(anotacion)}
      data-olimpica={estado}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-[0.625rem] font-semibold leading-none tabular-nums',
        DORADA,
        compacta && 'max-[359px]:border-0 max-[359px]:bg-transparent max-[359px]:px-0',
        className,
      )}
    >
      <IconoLaurel className="size-3" />
      {estado === 'clasificado' ? <Check className={cn('size-2.5', extra)} aria-hidden strokeWidth={3} /> : null}
      {estado === 'cerca' && anotacion.faltan !== null ? (
        <span aria-hidden className={extra}>{`−${puntos(anotacion.faltan)}`}</span>
      ) : null}
      {estado === 'pendiente' ? <Clock className={cn('size-2.5', extra)} aria-hidden strokeWidth={2.5} /> : null}
    </span>
  );
}
