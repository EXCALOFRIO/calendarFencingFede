import { ExternalLink } from 'lucide-react';
import { cn, esFechaIsoReal, formatDateEs } from '@/lib/utils';

/** Piezas de lectura que comparten la ficha deportiva y el cara a cara. */

export type Nivel = 'pagina' | 'seccion';

function Titulo({ nivel, id, children }: { nivel: Nivel; id: string; children: React.ReactNode }) {
  return nivel === 'pagina' ? (
    <h2 id={id} className="text-xl">
      {children}
    </h2>
  ) : (
    <h3 id={id} className="text-lg">
      {children}
    </h3>
  );
}

export function Bloque({
  id,
  titulo,
  nivel,
  children,
}: {
  id: string;
  titulo: string;
  nivel: Nivel;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div className="border-b pb-2">
        <Titulo nivel={nivel} id={id}>
          {titulo}
        </Titulo>
      </div>
      {children}
    </section>
  );
}

export function Nota({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('medida text-xs text-muted-foreground', className)}>{children}</p>;
}

export function Celda({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground md:sr-only">{etiqueta}</span>
      {children}
    </div>
  );
}

/** Una fecha que no existe se muestra en bruto: formatearla lanzaría o la disfrazaría. */
export function fechaLegible(iso: string): string {
  return esFechaIsoReal(iso) ? formatDateEs(iso) : iso;
}

/** Sólo enlaces web: una URL con otro esquema de una fuente no se vuelve clicable. */
export function enlaceSeguro(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function EnlaceFuente({ url, etiqueta }: { url: string | null; etiqueta: string }) {
  const href = enlaceSeguro(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:min-h-0"
    >
      {etiqueta}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

export function Dato({ children }: { children: React.ReactNode }) {
  return <span className="text-sm">{children}</span>;
}
