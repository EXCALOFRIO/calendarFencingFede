import { cn } from '@/lib/utils';
import type { Weapon } from '@/lib/queries/calendar';

/**
 * Iconos de las tres armas.
 *
 * Van **en horizontal**, con la punta a la derecha y la guarda a la
 * izquierda. No es un capricho: el sitio donde viven es una barra de
 * calendario, que es ancha y baja, y una espada vertical dentro de una caja
 * de 16 × 16 px deja el 70 % del ancho vacío y la hoja en cuatro píxeles. En
 * horizontal la hoja ocupa todo el ancho y la guarda tiene sitio para
 * distinguirse, que es lo único que de verdad separa un arma de otra.
 *
 * Lo que distingue a cada una, por orden de peso visual:
 *
 *   - **Florete**: coquille pequeña, un disco. Hoja recta y la más fina.
 *   - **Espada**: cazoleta grande y honda, el doble de radio. Hoja más
 *     gruesa, de sección triangular.
 *   - **Sable**: guarda de cesta, un aro ABIERTO que envuelve los nudillos,
 *     y hoja curva. Es la única silueta hueca de las tres.
 *
 * Disco pequeño macizo / disco grande macizo / aro hueco: tres masas
 * distintas. Eso se lee a 16 px; un contorno con dos píxeles de diferencia,
 * no. Se dibujan a mano porque ninguna librería de iconos (Lucide, Tabler,
 * Heroicons, Material) trae las tres armas de esgrima por separado: todas
 * tienen una «espada» genérica y aquí eso no vale para nada.
 */

type Props = { className?: string; title?: string };

function Svg({ className, title, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-full', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconoFlorete(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja: se afila hacia la punta, que queda en el borde derecho. */}
      <path d="M23.2 12 11 10.35v3.3Z" fill="currentColor" />
      {/* Coquille: disco pequeño, que es lo que la distingue de la espada. */}
      <circle cx="9" cy="12" r="3" fill="currentColor" />
      {/* Empuñadura francesa, recta, y pomo al final. */}
      <path
        d="M6.6 12H3.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="1.7" cy="12" r="1.5" fill="currentColor" />
    </Svg>
  );
}

export function IconoEspada(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja: más gruesa que la del florete, de sección triangular. */}
      <path d="M23.2 12 12.4 9.9v4.2Z" fill="currentColor" />
      {/* Cazoleta: cúpula honda, casi el doble de radio que la coquille del
          florete. Al lado la diferencia de masa se ve incluso a 14 px. */}
      <path d="M12.4 12a5.6 5.1 0 0 0-11.2 0z" fill="currentColor" />
      {/* La empuñadura sale por debajo de la cazoleta, que es donde va la
          mano: es lo que impide que la cúpula se lea como un paraguas. */}
      <path
        d="M6.8 12v5.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export function IconoSable(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja curva: el sable corta, y es la única de las tres que no es
          recta. La curva va hacia arriba, como una cimitarra. */}
      <path
        d="M22.8 7.2c-4 1.2-7.6 3-11 5.4l1.5 2.1c3.4-2.4 6.6-4.6 9.5-7.5Z"
        fill="currentColor"
      />
      {/* Guarda de cesta: aro ABIERTO sobre los nudillos. Hueco a propósito,
          para que no se confunda con la cazoleta maciza de la espada. */}
      <path
        d="M11.4 12.2c-2.4 0-4 1.7-4 3.7s1.6 3.5 4.2 3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M12.2 11.6 3 18.2"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export function IconoArma({
  arma,
  className,
  title,
}: {
  arma: Weapon;
  className?: string;
  title?: string;
}) {
  if (arma === 'ESPADA') return <IconoEspada className={className} title={title} />;
  if (arma === 'SABLE') return <IconoSable className={className} title={title} />;
  return <IconoFlorete className={className} title={title} />;
}
