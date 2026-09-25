import { cn } from '@/lib/utils';
import type { Weapon } from '@/lib/queries/calendar';

/**
 * Marca de arma.
 *
 * Aquí había tres iconos dibujados a mano (florete, espada, sable). Se
 * probaron tres versiones y se miraron renderizadas a 10, 12, 14 y 16 px, que
 * es el tamaño real que tienen dentro de una barra del calendario: a ese
 * tamaño las tres armas son **la misma línea con un bulto**. La diferencia
 * entre una coquille y una cazoleta son dos píxeles, y la cúpula de la espada
 * se leía como un paraguas. Un icono que no se distingue no informa: decora.
 *
 * Así que la marca es la **inicial**, que es además como las nombran la hoja
 * de resultados, Skermo y cualquier tirador: F, E, S. Se lee a 10 px, no se
 * confunde nunca y el nombre completo va en el `title` y en el texto
 * alternativo, de modo que quien no conozca la convención también lo sabe.
 *
 * Va en la condensada (`.cifra`) para que ocupe poco y case con las cifras
 * del calendario.
 */

const INICIAL: Record<Weapon, string> = {
  FLORETE: 'F',
  ESPADA: 'E',
  SABLE: 'S',
};

const NOMBRE: Record<Weapon, string> = {
  FLORETE: 'Florete',
  ESPADA: 'Espada',
  SABLE: 'Sable',
};

export function MarcaArma({
  armas,
  compacta = false,
  className,
}: {
  armas: Weapon[];
  compacta?: boolean;
  className?: string;
}) {
  if (armas.length === 0) return null;

  const orden: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];
  const presentes = orden.filter((a) => armas.includes(a));
  const etiqueta = presentes.map((a) => NOMBRE[a]).join(', ');

  return (
    <span
      title={etiqueta}
      aria-label={etiqueta}
      className={cn(
        'cifra shrink-0 rounded-[3px] bg-current/20 tracking-tight',
        compacta ? 'px-[3px] text-[9px]' : 'px-1 text-[10px]',
        className,
      )}
    >
      {presentes.map((a) => INICIAL[a]).join('')}
    </span>
  );
}

export { NOMBRE as NOMBRE_ARMA, INICIAL as INICIAL_ARMA };
