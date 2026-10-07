import { cn } from '@/lib/utils';

/*
 * Los cinco aros, de trazo y de un solo color (`currentColor`): toman el color
 * del estado del texto que los rodea (verde, amarillo o gris en la pastilla).
 *
 * Los centros y el radio son los del icono de línea de referencia, dibujado en
 * una rejilla de 48. El `viewBox` encuadra los aros más medio trazo por cada
 * lado; el trazo va algo más grueso que el de la rejilla de 48 para que a
 * 14–20 px de ancho cada aro siga siendo una línea y no un borrón.
 */
const RADIO = 5.816;
const GROSOR = 2.25;
const CENTROS: readonly (readonly [number, number])[] = [
  [10.316, 20.832],
  [24, 20.832],
  [37.684, 20.832],
  [17.158, 27.168],
  [30.842, 27.168],
];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const xs = CENTROS.map(([x]) => x);
const ys = CENTROS.map(([, y]) => y);
const BORDE = RADIO + GROSOR / 2;
const X0 = Math.min(...xs) - BORDE;
const Y0 = Math.min(...ys) - BORDE;
const VIEWBOX = [X0, Y0, Math.max(...xs) + BORDE - X0, Math.max(...ys) + BORDE - Y0].map(r3).join(' ');

/** Los aros olímpicos. Ancho ≈ 2 × alto: con `w-5` miden 20 × 10 px. */
export function IconoAros({ className, apagados = false }: { className?: string; apagados?: boolean }) {
  return (
    <svg
      viewBox={VIEWBOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={GROSOR}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      data-icono="aros"
      className={cn('h-auto w-5 shrink-0', apagados && 'opacity-60', className)}
    >
      {CENTROS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={RADIO} />
      ))}
    </svg>
  );
}
