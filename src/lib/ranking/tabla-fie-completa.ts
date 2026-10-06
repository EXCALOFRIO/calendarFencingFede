import type { TablaClasificacionFie } from '@/lib/queries/ranking';
import type { AnotacionesPrueba } from '@/lib/ranking/olimpica';

/**
 * Tabla del ranking internacional tal como la recibe la pantalla: la de la FIE
 * más las marcas olímpicas del grupo (`null` fuera de las seis pruebas
 * olímpicas) y la persona de cada fila por `fieId`.
 */
export type TablaFieCompleta = TablaClasificacionFie & {
  olimpica: AnotacionesPrueba | null;
  /** `String(fieId)` → persona deportiva. */
  personas: Record<string, string>;
};
