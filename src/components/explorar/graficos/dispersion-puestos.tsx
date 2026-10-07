import type { PuntoEvolucion } from '@/lib/sport/explorar/rendimiento';
import { mesAnio } from './comun';

/**
 * Utilidades de puestos sueltos. La nube de puntos del perfil (un punto por
 * competición) se sustituyó por los tramos por temporada (`tramos-puestos.tsx`):
 * con cientos de competiciones no se leía. Quedan la mediana móvil (la usa el
 * cara a cara) y la lectura de un puesto.
 */

/**
 * Mediana móvil de los últimos `ventana` puestos relativos (la tendencia sin
 * el ruido de un mal día), suavizada con una media centrada: con muchas
 * victorias la mediana salta entre «ganó» y «no ganó» y la línea sería un peine.
 */
export function tendencia(valores: number[], ventana = 9, suavizado = 4): number[] {
  const medianas = valores.map((_, i) => {
    const tramo = valores.slice(Math.max(0, i - ventana + 1), i + 1).sort((a, b) => a - b);
    const m = Math.floor(tramo.length / 2);
    return tramo.length % 2 ? tramo[m] : (tramo[m - 1] + tramo[m]) / 2;
  });
  return medianas.map((_, i) => {
    const tramo = medianas.slice(Math.max(0, i - suavizado), i + suavizado + 1);
    return tramo.reduce((s, v) => s + v, 0) / tramo.length;
  });
}

export type ResumenTendencia = { valor: number; sentido: 'mejora' | 'baja' | 'estable' | null };

/**
 * Dónde está ahora la tendencia (parte del cuadro por delante) y hacia dónde va
 * respecto a la de hace un año; sin un punto de hace un año, sólo el valor.
 * Menos de 3 puntos de diferencia es estable.
 */
export function resumenTendencia(linea: readonly number[], dias: readonly number[]): ResumenTendencia | null {
  const valor = linea.at(-1);
  const hoy = dias.at(-1);
  if (valor === undefined || hoy === undefined) return null;
  let antes: number | null = null;
  for (let i = dias.length - 1; i >= 0; i -= 1) {
    if (dias[i] <= hoy - 365) {
      antes = linea[i];
      break;
    }
  }
  if (antes === null) return { valor, sentido: null };
  const cambio = valor - antes;
  return { valor, sentido: cambio < -0.03 ? 'mejora' : cambio > 0.03 ? 'baja' : 'estable' };
}

export function lecturaPuesto(p: PuntoEvolucion): string {
  const cuadro = p.participantes ? ` de ${p.participantes}` : '';
  return `${p.puesto}º${cuadro}, ${p.torneo}, ${mesAnio(p.fecha ?? p.fechaOrden)}`;
}
