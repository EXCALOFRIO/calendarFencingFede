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

const TAMANO = {
  sm: 'size-9 text-lg',
  md: 'size-11 text-2xl',
  lg: 'size-14 text-3xl',
} as const;

/** Disco con el puesto: relleno del metal en el podio, aro en la final, filete fuera de ella. */
export function DiscoPuesto({
  puesto,
  puestoPublicado = null,
  tamano = 'md',
  className,
}: {
  puesto: number | null;
  puestoPublicado?: string | null;
  tamano?: keyof typeof TAMANO;
  className?: string;
}) {
  const medalla = medallaDe(puesto);
  if (puesto === null) {
    const texto = puestoPublicado ?? 'Sin puesto publicado';
    return (
      <span
        role="img"
        aria-label={texto}
        title={texto}
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-filete-alto text-muted-foreground', TAMANO[tamano], className)}
      >
        <span aria-hidden="true" className="cifra leading-none">–</span>
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={medalla ? `Puesto ${puesto}, ${nombreMedalla(medalla)}` : `Puesto ${puesto}`}
      data-medalla={medalla ? puesto : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        TAMANO[tamano],
        medalla ? 'text-[#1a1408] shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)]' : puesto <= 8 ? 'border-2 border-foreground/70' : 'border border-filete-alto',
        className,
      )}
      style={medalla ? { backgroundColor: COLOR_MEDALLA[medalla] } : undefined}
    >
      <span aria-hidden="true" className={cn('cifra leading-none', puesto >= 100 && 'text-[0.8em]')}>{puesto}</span>
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
            'inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs font-semibold leading-none whitespace-nowrap',
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
