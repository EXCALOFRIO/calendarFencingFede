import { Puesto } from '@/components/sistema/pastilla';
import { CLASES_MEDALLA, COLOR_MEDALLA, medallaDe, type Medalla } from '@/lib/sport/explorar/presentacion';
import { cn } from '@/lib/utils';

/**
 * Puestos y medallas del perfil con el color de su metal. Sin estado ni
 * datos de servidor: sirven igual en componentes de servidor y de cliente.
 * El color nunca comunica solo: la cifra o el nombre van siempre escritos.
 */

const NOMBRE: Record<Medalla, [string, string]> = {
  oro: ['oro', 'oros'],
  plata: ['plata', 'platas'],
  bronce: ['bronce', 'bronces'],
};

export function nombreMedalla(m: Medalla, n = 1): string {
  return NOMBRE[m][n === 1 ? 0 : 1];
}

/**
 * El puesto de una fila de resultado: el `Puesto` del sistema (disco con el
 * metal del 1 al 3, que el lector oye) en una caja fija de 32 px, para que
 * los nombres caigan en la misma vertical. Sin puesto numérico, el literal
 * publicado («DNF») queda en el `title` y el lector lo oye; nunca un cero.
 */
export function DiscoPuesto({
  puesto,
  puestoPublicado = null,
  className,
}: {
  puesto: number | null;
  puestoPublicado?: string | null;
  /** @deprecated Todas las filas usan la misma medida. */
  tamano?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  if (puesto === null) {
    const texto = puestoPublicado ?? 'Sin puesto publicado';
    return (
      <span title={texto} className={cn('inline-flex size-8 shrink-0 items-center justify-center text-sm text-muted-foreground', className)}>
        <span className="sr-only">{texto}</span>
        <span aria-hidden="true">–</span>
      </span>
    );
  }
  return (
    <span data-medalla={medallaDe(puesto) ? puesto : undefined} className={cn('inline-flex size-8 shrink-0 items-center justify-center', className)}>
      <Puesto puesto={puesto} tamano="md" />
    </span>
  );
}

/** Punto del color del metal. Decorativo: la cifra y el nombre van al lado. */
export function PuntoMedalla({ medalla, className }: { medalla: Medalla; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: COLOR_MEDALLA[medalla] }}
    />
  );
}

/**
 * Oros, platas y bronces en pastillas del color del metal. `ocultarCeros`
 * deja sólo las que tienen alguna (para filas pequeñas).
 */
export function Medallero({
  oros,
  platas,
  bronces,
  ocultarCeros = false,
  className,
}: {
  oros: number;
  platas: number;
  bronces: number;
  ocultarCeros?: boolean;
  className?: string;
}) {
  const lista = ([['oro', oros], ['plata', platas], ['bronce', bronces]] as const)
    .filter(([, n]) => !ocultarCeros || n > 0);
  if (lista.length === 0) return null;
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {lista.map(([m, n]) => (
        <span
          key={m}
          title={`${n} ${nombreMedalla(m, n)}`}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold leading-none whitespace-nowrap',
            n > 0 ? CLASES_MEDALLA[m] : 'border-filete-alto text-muted-foreground',
          )}
        >
          <PuntoMedalla medalla={m} className={n > 0 ? undefined : 'opacity-40'} />
          <span className="cifra text-sm leading-none">{n}</span>
          <span className="sr-only">{nombreMedalla(m, n)}</span>
        </span>
      ))}
    </span>
  );
}
