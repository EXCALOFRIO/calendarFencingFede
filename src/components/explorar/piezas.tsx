import { ExternalLink } from 'lucide-react';
import { cn, esFechaIsoReal, formatDateEs } from '@/lib/utils';

/** Piezas de lectura que comparten la ficha deportiva y el cara a cara. */

export type Nivel = 'pagina' | 'seccion';

function Titulo({ nivel, id, children }: { nivel: Nivel; id: string; children: React.ReactNode }) {
  return nivel === 'pagina' ? (
    <h2 id={id} className="text-2xl leading-tight break-words sm:text-3xl">
      {children}
    </h2>
  ) : (
    <h3 id={id} className="text-xl leading-tight break-words sm:text-2xl">
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
      <div className="border-b pb-3">
        <Titulo nivel={nivel} id={id}>
          {titulo}
        </Titulo>
      </div>
      {children}
    </section>
  );
}

export function Nota({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('medida text-xs leading-relaxed text-muted-foreground', className)}>{children}</p>;
}

/** La explicación sigue disponible sin competir con los datos de la ficha. */
export function Aclaracion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <details className="min-w-0 text-sm">
      <summary className="min-h-11 cursor-pointer content-center rounded-sm py-2 text-muted-foreground break-words hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        {titulo}
      </summary>
      <div className="flex min-w-0 flex-col gap-3 border-l pl-4 pb-3">{children}</div>
    </details>
  );
}

export function Celda({
  etiqueta,
  children,
  className,
}: {
  etiqueta: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs leading-relaxed text-muted-foreground">{etiqueta}</span>
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
      className="inline-flex min-h-11 w-fit max-w-full items-center gap-1.5 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {etiqueta}
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}

export function Dato({ children }: { children: React.ReactNode }) {
  return <span className="text-sm">{children}</span>;
}
