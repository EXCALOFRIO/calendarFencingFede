import { cn } from '@/lib/utils';

/**
 * Piezas pequeñas del perfil deportivo: métrica y cifra. Los puestos van con
 * `Puesto` (`sistema/pastilla`) o `DiscoPuesto` (`./medallas`) y las fechas
 * con `@/lib/fechas`.
 */

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
    <div className={cn('flex min-w-0 flex-col gap-2 bg-card p-4 sm:p-5', className)}>
      <dt className="text-xs leading-tight text-muted-foreground">{etiqueta}</dt>
      <dd className="flex min-w-0 flex-col gap-2">
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
