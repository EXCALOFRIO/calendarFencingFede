import { Medal } from 'lucide-react';
import { cn, esFechaIsoReal } from '@/lib/utils';

/** Piezas pequeñas del perfil deportivo: medalla, puesto final, fecha corta y métrica. */

const MEDALLAS: Record<number, string> = { 1: 'Oro', 2: 'Plata', 3: 'Bronce' };

export function etiquetaMedalla(puesto: number | null): string | null {
  return puesto === null ? null : MEDALLAS[puesto] ?? null;
}

/**
 * Puesto final publicado. Un podio lleva el nombre de la medalla escrito al
 * lado (el color nunca comunica solo, y el dorado es exclusivo de las
 * convocatorias). Un literal sin número se enseña tal cual, nunca como cero.
 */
export function PuestoFinal({
  puesto,
  puestoPublicado = null,
  className,
}: {
  puesto: number | null;
  puestoPublicado?: string | null;
  className?: string;
}) {
  if (puesto === null) {
    return (
      <span className={cn('text-sm', className)}>
        {puestoPublicado ?? <span className="text-muted-foreground">Sin puesto publicado</span>}
      </span>
    );
  }
  const medalla = etiquetaMedalla(puesto);
  return (
    <span className={cn('flex flex-col items-end gap-1', className)}>
      <span className="flex items-baseline gap-1">
        <span className="cifra text-4xl leading-none">{puesto}</span>
        <span className="text-xs text-muted-foreground">º</span>
      </span>
      {medalla ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-filete-alto px-2 py-0.5 text-xs font-medium">
          <Medal className="size-3.5" aria-hidden />
          {medalla}
        </span>
      ) : puesto <= 8 ? (
        <span className="text-xs text-muted-foreground">Final</span>
      ) : null}
    </span>
  );
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** Día y mes por separado para la columna de la línea de tiempo; sin zona horaria de por medio. */
export function partesFecha(iso: string): { dia: string; mes: string; anio: string } | null {
  if (!esFechaIsoReal(iso)) return null;
  const [anio, mes, dia] = iso.split('-');
  return { dia: String(Number(dia)), mes: MESES[Number(mes) - 1], anio };
}

export function Metrica({
  etiqueta,
  children,
  detalle,
  className,
}: {
  etiqueta: string;
  children: React.ReactNode;
  detalle?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 bg-card px-4 py-4 sm:px-5 sm:py-5', className)}>
      <dt className="text-xs leading-tight text-muted-foreground">{etiqueta}</dt>
      <dd className="flex min-w-0 flex-col gap-1.5">
        {children}
        {detalle ? <span className="text-xs leading-relaxed text-muted-foreground">{detalle}</span> : null}
      </dd>
    </div>
  );
}

export function SinDato({ children = 'Sin datos importados' }: { children?: React.ReactNode }) {
  return <span className="text-sm leading-snug text-muted-foreground">{children}</span>;
}

export function Cifra({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('cifra text-5xl leading-none whitespace-nowrap sm:text-6xl', className)}>{children}</span>;
}
