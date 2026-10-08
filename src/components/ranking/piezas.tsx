import { ExternalLink } from 'lucide-react';
import { AREA_TACTIL, FOCO, SIN_MINIMO } from '@/components/sistema/tactil';
import { frescura } from '@/lib/fechas';
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
  /** Cuándo se leyó la tabla; sale como «Actualizado el 5 oct». */
  leida: string | Date | null;
  url: string | null;
}) {
  const datos = [temporada, frescura(leida)].filter(Boolean);
  if (datos.length === 0 && !url) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
      {datos.length > 0 ? <span>{datos.join(' · ')}</span> : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={cn(SIN_MINIMO, FOCO, AREA_TACTIL, 'inline-flex items-center gap-1 rounded-md text-primary-text underline-offset-4 hover:underline')}
        >
          Original
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      ) : null}
    </p>
  );
}
