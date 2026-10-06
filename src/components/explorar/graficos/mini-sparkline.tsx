import { cn } from '@/lib/utils';
import { camino, COLOR, tinte, tramos, xColumna, yPercentil } from './comun';
import { Lienzo } from './eje';

/**
 * Línea mínima sin ejes para acompañar una cifra («81 %» y su evolución).
 * Ocupa el ancho del contenedor; el último valor lleva punto.
 */
export function MiniSparkline({
  valores,
  titulo,
  color = COLOR.marca,
  escala = 'lineal',
  min,
  max,
  area = true,
  className,
}: {
  valores: (number | null)[];
  titulo: string;
  color?: string;
  /** `percentil`: valores 0–1 con 0 arriba (puesto relativo). */
  escala?: 'lineal' | 'percentil';
  min?: number;
  max?: number;
  area?: boolean;
  className?: string;
}) {
  const n = valores.length;
  const datos = valores.filter((v): v is number => v !== null);
  if (datos.length < 2) return null;
  const lo = min ?? Math.min(...datos);
  const hi = max ?? Math.max(...datos);
  const y = (v: number) =>
    escala === 'percentil' ? 8 + yPercentil(v) * 0.84 : hi === lo ? 50 : 92 - ((v - lo) / (hi - lo)) * 84;
  const ps = valores.map((v, i) => (v === null ? null : { x: xColumna(i, n), y: y(v) }));
  const ultimo = [...ps].reverse().find((p) => p !== null);
  return (
    <span role="img" aria-label={titulo} className={cn('relative block h-7 w-full min-w-0', className)}>
      <Lienzo>
        {tramos(ps).map((t, j) => (
          <g key={j}>
            {area && t.length > 1 ? (
              <path d={`${camino(t)} L${t[t.length - 1].x.toFixed(2)} 100 L${t[0].x.toFixed(2)} 100 Z`} style={{ fill: tinte(color, 14) }} />
            ) : null}
            <path d={camino(t)} fill="none" strokeWidth={1.5} style={{ stroke: color }} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </Lienzo>
      {ultimo ? (
        <span
          aria-hidden
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${ultimo.x}%`, top: `${ultimo.y}%`, background: color }}
        />
      ) : null}
    </span>
  );
}
