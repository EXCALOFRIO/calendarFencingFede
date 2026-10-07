'use client';

import type { AnotacionOlimpica } from '@/lib/ranking/olimpica';
import { BurbujaOlimpica } from './burbuja-olimpica';

/**
 * La etiqueta olímpica de una fila o de la cabecera del perfil. Es la misma
 * `BurbujaOlimpica` (se toca y explica el estado); se mantiene el nombre para
 * quien ya la usa. La fecha del ranking sale de la anotación si no se pasa.
 * Sin interacción, `PastillaOlimpica`.
 */
export function InsigniaOlimpica(props: {
  anotacion: AnotacionOlimpica | null | undefined;
  fechaRanking?: string | null;
  compacta?: boolean;
  className?: string;
}) {
  return <BurbujaOlimpica {...props} />;
}
