import { COLOR_ORGANISMO } from '@/lib/colores';
import { cn, type Organismo } from '@/lib/utils';

/**
 * Insignia de quién organiza una prueba: siglas sobre el tinte del organismo y
 * un filete de su color a la izquierda, la misma señal que la barra del
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
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border-l-[3px] pr-2 pl-1.5 text-[12px] leading-none font-bold tracking-[0.08em]',
        color.borde,
        color.tintePastilla,
        color.texto,
        className,
      )}
    >
      <span className="sr-only">Organiza: </span>
      {SIGLAS[organismo]}
      <span className="sr-only"> ({NOMBRE[organismo]})</span>
    </span>
  );
}
