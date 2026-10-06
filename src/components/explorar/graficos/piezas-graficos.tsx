import type { Nivel } from '../piezas';
import { cn } from '@/lib/utils';

/** Piezas de maquetación de las secciones de gráficas: subtítulo, rejilla con filetes y celda. */

export function Subtitulo({ nivel, children, className }: { nivel: Nivel; children: React.ReactNode; className?: string }) {
  const Etiqueta = nivel === 'pagina' ? 'h3' : 'h4';
  return <Etiqueta className={cn('font-display text-lg leading-none font-semibold tracking-tight', className)}>{children}</Etiqueta>;
}

/** Celdas separadas por filetes de un píxel (la rejilla pinta el fondo y cada celda tapa el suyo). */
export function Rejilla({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid min-w-0 gap-px overflow-hidden border-y bg-border', className)}>{children}</div>;
}

export function Celda({
  rotulo,
  cifra,
  unidad,
  contexto,
  children,
  className,
}: {
  rotulo: string;
  cifra?: React.ReactNode;
  unidad?: string;
  /** Texto diminuto junto a la cifra («en 24-25»). */
  contexto?: string | null;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 bg-card px-3 py-3 sm:px-4', className)}>
      <div className="flex min-w-0 items-end justify-between gap-3">
        <span className="min-w-0 text-xs leading-tight break-words text-muted-foreground">{rotulo}</span>
        {cifra !== undefined && cifra !== null ? (
          <span className="flex shrink-0 items-baseline gap-1">
            {contexto ? <span className="text-[0.625rem] leading-none text-muted-foreground">{contexto}</span> : null}
            <span className="cifra text-3xl leading-none">
              {cifra}
              {unidad ? <span className="text-base">{unidad}</span> : null}
            </span>
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Dos cifras enfrentadas con una barra partida en proporción (marcador de un duelo). */
export function BarraDuelo({
  izquierda,
  derecha,
  colorIzquierda,
  colorDerecha,
  rotuloIzquierda,
  rotuloDerecha,
  formato = String,
  tamano = 'text-3xl',
}: {
  izquierda: number;
  derecha: number;
  colorIzquierda: string;
  colorDerecha: string;
  rotuloIzquierda?: string;
  rotuloDerecha?: string;
  formato?: (v: number) => string;
  tamano?: string;
}) {
  const total = izquierda + derecha;
  const p = total > 0 ? (izquierda / total) * 100 : 50;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-end justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={cn('cifra leading-none', tamano)}>{formato(izquierda)}</span>
          {rotuloIzquierda ? <span className="truncate text-[0.625rem] text-muted-foreground">{rotuloIzquierda}</span> : null}
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          {rotuloDerecha ? <span className="truncate text-[0.625rem] text-muted-foreground">{rotuloDerecha}</span> : null}
          <span className={cn('cifra leading-none text-muted-foreground', tamano)}>{formato(derecha)}</span>
        </span>
      </div>
      <div aria-hidden className="flex h-1.5 gap-0.5">
        {total === 0 ? <span className="flex-1 rounded-full bg-muted" /> : null}
        {izquierda > 0 ? <span className="rounded-full" style={{ width: `${p}%`, background: colorIzquierda }} /> : null}
        {derecha > 0 ? <span className="flex-1 rounded-full" style={{ background: colorDerecha }} /> : null}
      </div>
    </div>
  );
}
