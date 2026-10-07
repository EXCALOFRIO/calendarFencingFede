/**
 * El gesto de bajar la hoja inferior, en números. Sin DOM para poder
 * probarlo; `hoja-inferior.tsx` sólo le pasa lo que mide el puntero.
 */

/** px/ms hacia abajo a partir de los cuales un gesto corto ya cierra (un «tirón»). */
export const VELOCIDAD_CIERRE = 0.5;
/** Un tirón tiene que haber movido la hoja al menos esto, para no cerrar con un toque. */
export const RECORRIDO_MINIMO_TIRON = 16;

export function decidirCierre({
  desplazamiento,
  alto,
  velocidad,
}: {
  /** px recorridos hacia abajo desde que empezó el gesto. */
  desplazamiento: number;
  /** Alto de la hoja en px. */
  alto: number;
  /** px/ms al soltar; positivo hacia abajo. */
  velocidad: number;
}): boolean {
  if (desplazamiento <= 0) return false;
  if (velocidad >= VELOCIDAD_CIERRE && desplazamiento >= RECORRIDO_MINIMO_TIRON) return true;
  return desplazamiento >= Math.min(alto * 0.33, 160);
}

/** Hacia arriba la hoja no se despega: cede poco y cada vez menos, como en iOS. */
export function conResistencia(desplazamiento: number): number {
  return desplazamiento >= 0 ? desplazamiento : -Math.sqrt(-desplazamiento) * 2;
}
