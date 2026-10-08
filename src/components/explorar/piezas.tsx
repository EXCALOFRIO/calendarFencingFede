import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais, type TamañoBandera } from '@/components/bandera';
import { CabeceraSeccion } from '@/components/sistema/cabecera-seccion';
import { fechaCorta } from '@/lib/fechas';
import { rutaPaisDe } from '@/lib/sport/explorar/enlace-pais';
import { cn, esFechaIsoReal } from '@/lib/utils';

/** Piezas de lectura que comparten la ficha deportiva y el cara a cara. */

export type Nivel = 'pagina' | 'seccion';

export function Bloque({
  id,
  titulo,
  nivel,
  children,
  tituloOculto = false,
}: {
  id: string;
  titulo: string;
  nivel: Nivel;
  children: React.ReactNode;
  /** Dentro de una pestaña el rótulo ya está a la vista: el título queda para lectores de pantalla. */
  tituloOculto?: boolean;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <CabeceraSeccion
        id={id}
        titulo={titulo}
        nivel={nivel === 'pagina' ? 'pagina' : 'seccion'}
        como={nivel === 'pagina' ? 'h2' : 'h3'}
        className={tituloOculto ? 'sr-only' : 'border-b pb-3'}
      />
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
      <summary className="min-h-[44px] cursor-pointer content-center rounded-sm py-2 text-muted-foreground break-words hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none">
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
  return esFechaIsoReal(iso) ? fechaCorta(iso, { anio: 'siempre' }) : iso;
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
      className="inline-flex min-h-[44px] w-fit max-w-full items-center gap-2 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
    >
      {etiqueta}
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}

/**
 * Una bandera que abre la página de su país. Se toca en 44 × 44 aunque se vea
 * de 18 px; sin país al que ir (código desconocido, «FIE») es la bandera sola.
 * No puede ir dentro de otro enlace: quien la use la pone como hermana.
 */
export function EnlacePais({
  pais,
  soloBandera = true,
  tamaño = 'fila',
  className,
}: {
  pais: string | null | undefined;
  soloBandera?: boolean;
  tamaño?: TamañoBandera;
  className?: string;
}) {
  const href = rutaPaisDe(pais);
  if (!pais) return null;
  if (!href) return <BanderaPais pais={pais} soloBandera={soloBandera} tamaño={tamaño} className={className} />;
  return (
    <Link
      href={href}
      prefetch={false}
      data-enlace="pais"
      className={cn(
        'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <BanderaPais pais={pais} soloBandera={soloBandera} tamaño={tamaño} />
    </Link>
  );
}

export function Dato({ children }: { children: React.ReactNode }) {
  return <span className="text-sm">{children}</span>;
}
