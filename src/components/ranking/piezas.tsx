import { ExternalLink } from 'lucide-react';
import type * as React from 'react';
import { AREA_TACTIL, FOCO, SIN_MINIMO } from '@/components/sistema/tactil';
import { cn } from '@/lib/utils';

/**
 * Temporada y fecha de lectura de la tabla, en una línea pequeña, con el
 * enlace al original. Sin «Fuente: …» ni la sigla del organismo: lo dice el
 * chip del ámbito (`docs/diseno-sistema.md` § 6).
 */
export function Procedencia({
  temporada = null,
  leida,
  url,
}: {
  temporada?: string | null;
  leida: string | null;
  url: string | null;
}) {
  const datos = [temporada, leida].filter(Boolean);
  if (datos.length === 0 && !url) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-[8px] gap-y-0.5 text-[12px] leading-5 text-muted-foreground">
      {datos.length > 0 ? <span>{datos.join(' · ')}</span> : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={cn(SIN_MINIMO, FOCO, AREA_TACTIL, 'inline-flex items-center gap-1 rounded-sm text-primary-text underline-offset-4 hover:underline')}
        >
          Original
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      ) : null}
    </p>
  );
}

/** «Ver 50 más»: ancho completo, compacto, con área táctil de 44 px. */
export function VerMas({ className, children, ...resto }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        SIN_MINIMO,
        AREA_TACTIL,
        FOCO,
        'inline-flex h-[36px] w-full max-w-3xl items-center justify-center gap-2 rounded-full bg-secondary text-[13px] font-medium hover:bg-accent',
        className,
      )}
      {...resto}
    >
      {children}
    </button>
  );
}
