import { cn } from '@/lib/utils';
import { COLOR, pct } from './comun';

/**
 * Anillo de proporción (asaltos ganados) con la cifra en el centro. El anillo
 * es decorativo: la cifra y el rótulo dicen lo mismo en texto. Tamaño fijo en
 * píxeles, no se estira con el contenedor.
 */
export function Donut({
  valor,
  rotulo,
  detalle,
  color = COLOR.marca,
  tamano = 88,
  grosor = 7,
  className,
}: {
  /** Proporción 0–1; `null` pinta el anillo vacío y una raya. */
  valor: number | null;
  rotulo: string;
  /** Línea pequeña bajo el rótulo (p. ej. «872–211»). */
  detalle?: string | null;
  color?: string;
  tamano?: number;
  grosor?: number;
  className?: string;
}) {
  const r = 50 - grosor / 2;
  const largo = 2 * Math.PI * r;
  const p = valor === null ? 0 : Math.min(1, Math.max(0, valor));
  const cifra = pct(valor);
  return (
    <figure
      className={cn('flex min-w-0 flex-col items-center gap-2 text-center', className)}
      aria-label={cifra === null ? rotulo : `${rotulo}: ${cifra}%`}
    >
      <div className="relative" style={{ width: tamano, height: tamano }}>
        <svg aria-hidden viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth={grosor} style={{ stroke: 'var(--muted)' }} />
          {p > 0 ? (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              strokeWidth={grosor}
              strokeLinecap={p < 1 ? 'round' : 'butt'}
              strokeDasharray={`${(p * largo).toFixed(2)} ${largo.toFixed(2)}`}
              style={{ stroke: color }}
            />
          ) : null}
        </svg>
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <span className="cifra text-3xl leading-none">
            {cifra === null ? '–' : cifra}
            {cifra === null ? null : <span className="text-base">%</span>}
          </span>
        </span>
      </div>
      <figcaption className="flex flex-col leading-tight">
        <span className="text-xs font-medium text-foreground">{rotulo}</span>
        {detalle ? <span className="text-xs text-muted-foreground tabular-nums">{detalle}</span> : null}
      </figcaption>
    </figure>
  );
}
