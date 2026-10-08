import { cn } from '@/lib/utils';

const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function lecturaVictorias(victorias: number, derrotas: number): string {
  return `${contar(victorias, 'victoria', 'victorias')} y ${contar(derrotas, 'derrota', 'derrotas')}`;
}

/**
 * Balance de asaltos en una barra partida: victorias en verde a la izquierda y
 * derrotas en rojo a la derecha, con las dos cifras a los lados.
 */
export function BarraVictorias({
  victorias,
  derrotas,
  className,
}: {
  victorias: number;
  derrotas: number;
  className?: string;
}) {
  const total = victorias + derrotas;
  const pct = total > 0 ? (victorias / total) * 100 : 50;
  return (
    <span
      role="img"
      aria-label={lecturaVictorias(victorias, derrotas)}
      className={cn('flex w-full min-w-0 items-center gap-2', className)}
    >
      <span aria-hidden className="cifra min-w-4 text-right text-base leading-none text-ok">{victorias}</span>
      <span aria-hidden className="flex h-2 min-w-8 flex-1 gap-px">
        {total === 0 ? <span className="flex-1 rounded-full bg-muted" /> : null}
        {victorias > 0 ? <span className="rounded-full bg-ok" style={{ width: `${pct}%` }} /> : null}
        {derrotas > 0 ? <span className="flex-1 rounded-full bg-danger" /> : null}
      </span>
      <span aria-hidden className="cifra min-w-4 text-base leading-none text-danger">{derrotas}</span>
    </span>
  );
}
