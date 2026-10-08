import { clasesPastilla } from '@/components/sistema/pastilla';
import { COLOR_ORGANISMO } from '@/lib/colores';
import { cn, type Organismo } from '@/lib/utils';

/**
 * Insignia de quién organiza una prueba: una pastilla con las siglas sobre el
 * tinte del organismo y un punto de su color, el mismo de la leyenda del
 * calendario. Es propia de la aplicación y vale igual para los cuatro: no se
 * usa el logotipo de nadie (y de la EFC tampoco la bandera de la UE, que no es
 * suya).
 */

const NOMBRE: Record<Organismo, string> = {
  FIE: 'Federación Internacional de Esgrima',
  EFC: 'Confederación Europea de Esgrima',
  RFEE: 'Real Federación Española de Esgrima',
  AUT: 'Federación autonómica',
};

const SIGLAS: Record<Organismo, string> = { FIE: 'FIE', EFC: 'EFC', RFEE: 'RFEE', AUT: 'AUT' };

export function InsigniaOrganismo({
  organismo,
  className,
}: {
  organismo: Organismo;
  className?: string;
}) {
  const color = COLOR_ORGANISMO[organismo];
  return (
    <span
      data-organismo={organismo}
      title={NOMBRE[organismo]}
      className={cn(
        clasesPastilla('neutro', 'md'),
        'gap-2 text-xs font-semibold tracking-wide',
        color.tintePastilla,
        color.texto,
        className,
      )}
    >
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', color.punto)} />
      <span className="sr-only">Organiza: </span>
      {SIGLAS[organismo]}
      <span className="sr-only"> ({NOMBRE[organismo]})</span>
    </span>
  );
}
