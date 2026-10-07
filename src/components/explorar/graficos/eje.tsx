import { cn } from '@/lib/utils';

/**
 * Piezas de eje compartidas: rótulos del eje X colocados en % y líneas guía
 * horizontales con su rótulo pegado a la izquierda. Todo HTML para que la
 * letra no escale con el ancho de la gráfica.
 */

export const ALTO = {
  sm: 'h-24',
  md: 'h-32',
  lg: 'h-44 sm:h-52',
} as const;
export type Alto = keyof typeof ALTO;

/** Separación mínima entre rótulos, en % del ancho: a 393 px y 12 px de letra caben unos seis de cinco cifras. */
const HUECO_ROTULO = 15;
/** Por debajo de 640 px (320 px, o el texto grande del sistema) un rótulo ocupa más del ancho: menos rótulos. */
const HUECO_ESTRECHO = 24;

/** El primero y el último se alinean hacia dentro para no salirse del ancho. */
const enBorde = (x: number) => x < 8 || x > 92;

type Rotulo = { x: number; texto: string };

/** De derecha a izquierda, para que el último (lo más reciente) siempre quede. */
function espaciar(rotulos: readonly Rotulo[], base: number): Rotulo[] {
  const visibles: Rotulo[] = [];
  for (const r of [...rotulos].sort((a, b) => b.x - a.x)) {
    const ultimo = visibles[visibles.length - 1];
    // Un rótulo alineado al borde ocupa todo su ancho hacia dentro, no la mitad: su vecino necesita más hueco.
    const hueco = ultimo && (enBorde(ultimo.x) || enBorde(r.x)) ? base * 1.5 : base;
    if (!ultimo || ultimo.x - r.x >= hueco) visibles.push(r);
  }
  return visibles;
}

export function EjeX({ rotulos, className }: { rotulos: Rotulo[]; className?: string }) {
  const visibles = espaciar(rotulos, HUECO_ROTULO);
  // Sale de los ya elegidos: en estrecho sólo se ocultan rótulos, nunca aparece otro.
  const estrechos = new Set(espaciar(visibles, HUECO_ESTRECHO));
  return (
    <div aria-hidden className={cn('relative h-4 text-[12px] leading-4 text-muted-foreground tabular-nums', className)}>
      {visibles.map((r, i) => {
        const borde = r.x < 8 ? 'translate-x-0' : r.x > 92 ? '-translate-x-full' : '-translate-x-1/2';
        return (
          <span key={`${r.texto}-${i}`} className={cn('absolute top-0 whitespace-nowrap', borde, !estrechos.has(r) && 'max-sm:hidden')} style={{ left: `${r.x}%` }}>
            {r.texto}
          </span>
        );
      })}
    </div>
  );
}

export function Guias({ marcas }: { marcas: { y: number; rotulo?: string; fuerte?: boolean }[] }) {
  return (
    <>
      {marcas.map((m, i) => (
        <div
          key={i}
          aria-hidden
          className={cn('absolute inset-x-0 border-t', m.fuerte ? 'border-filete-alto' : 'border-dashed border-filete')}
          style={{ top: `${m.y}%` }}
        >
          {m.rotulo ? (
            <span className="absolute -top-3.5 left-0 text-[12px] leading-3 whitespace-nowrap text-muted-foreground tabular-nums">
              {m.rotulo}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

/** Lienzo SVG estirado al área del gráfico; los trazos no escalan. */
export function Lienzo({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {children}
    </svg>
  );
}

export function Punto({
  x,
  y,
  color,
  tamano = 7,
  lectura,
  borde,
  className,
}: {
  x: number;
  y: number;
  color: string;
  tamano?: number;
  lectura?: string | null;
  /** Aro de otro color (p. ej. de medalla). */
  borde?: string;
  className?: string;
}) {
  return (
    <span
      data-lectura={lectura ?? undefined}
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2 rounded-full',
        // Área táctil mayor que el punto, sin cambiar lo que se ve.
        lectura ? "before:absolute before:-inset-2 before:content-[''] hover:z-10 hover:scale-150" : null,
        className,
      )}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: tamano,
        height: tamano,
        background: color,
        boxShadow: borde ? `0 0 0 1px var(--background), 0 0 0 2.5px ${borde}` : '0 0 0 1.5px var(--background)',
      }}
    />
  );
}

export function Leyenda({ items, className }: { items: { color: string; texto: string; forma?: 'punto' | 'aro' | 'linea' | 'barra' }[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-muted-foreground', className)}>
      {items.map((it) => (
        <li key={it.texto} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden
            className={cn(
              'inline-block shrink-0',
              it.forma === 'linea' ? 'h-0.5 w-3 rounded-full' : it.forma === 'barra' ? 'size-2.5 rounded-[2px]' : 'size-2 rounded-full',
            )}
            style={it.forma === 'aro' ? { boxShadow: `inset 0 0 0 1.5px ${it.color}` } : { background: it.color }}
          />
          {it.texto}
        </li>
      ))}
    </ul>
  );
}
