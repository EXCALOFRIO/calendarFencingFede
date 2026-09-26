import { cn } from '@/lib/utils';
import type { Weapon } from '@/lib/queries/calendar';

/**
 * Iconos de las tres armas de esgrima.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ ESTÁN ASÍ, Y NO DE LAS OTRAS CUATRO FORMAS QUE SE PROBARON
 * -------------------------------------------------------------------------
 *
 * Estos iconos se han dibujado cinco veces. Hay un banco de pruebas que los
 * pinta a los tamaños REALES a los que viven —12, 14, 16, 18 px— porque las
 * cuatro versiones anteriores se dieron por buenas mirándolas a 48 px y a
 * tamaño de barra de calendario eran indistinguibles o parecían otra cosa:
 *
 *   `node tests/ui/iconos.mjs`  →  capturas/iconos.png
 *
 * Lo que se aprendió, en orden:
 *
 * 1. **Verticales, con trazo fino**: las tres eran «una rayita con un bulto».
 * 2. **Verticales, con la guarda rellena**: la espada se leía como un
 *    paraguas y el sable como un «6».
 * 3. **Diagonales, con la hoja rellena**: ganaron masa y se distinguían, pero
 *    el florete parecía un cometa.
 * 4. **Horizontales**: el mejor reparto del espacio —la caja es cuadrada y la
 *    hoja ocupa todo el ancho— pero la guarda seguía **alineada con los
 *    ejes**, así que la espada parecía una bandera y el florete un dardo.
 *
 * 5. Y aquí está la clave, que es de dibujo y no de tamaño: **la guarda tiene
 *    que ser perpendicular a la hoja**. Es lo que hace que un trazo con un
 *    bulto se lea como un arma y no como un objeto cualquiera. Por eso cada
 *    guarda va rotada 45° para casar con la diagonal de su hoja, con
 *    `transform` sobre el grupo, y no dibujada a mano en coordenadas.
 *
 * Lo que distingue a cada arma —y es lo único que las distingue de verdad,
 * también en la realidad— es la guarda:
 *
 *   FLORETE   coquille pequeña y plana, del tamaño de la palma.
 *   ESPADA    cazoleta grande y honda: la mano es blanco válido y hay que
 *             protegerla, así que mide casi el doble.
 *   SABLE     guarda de cesta: un aro CERRADO que va de la guarda al pomo
 *             envolviendo los nudillos, porque el sable corta. Es la única
 *             silueta hueca de las tres, y además su hoja es curva.
 *
 * Disco pequeño / disco grande / aro hueco y hoja curva: tres masas
 * distintas. Eso se lee a 14 px; un detalle de contorno, no.
 *
 * Se dibujan a mano porque ninguna librería de iconos (Lucide, que es la que
 * usa esta aplicación, Tabler, Heroicons, Material) trae las tres armas de
 * esgrima por separado: todas tienen una «espada» genérica, y aquí eso no
 * distingue nada.
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

/**
 * Los trazos van ESCRITOS, sin ayudantes que los calculen.
 *
 * Se intentó con dos componentes, `Hoja` y `Puno`, para no repetir. Pero el
 * banco de pruebas saca los trazos del fichero con una expresión regular y
 * no expande componentes, así que pintaba iconos a los que les faltaba la
 * hoja y el puño, y sobre esa imagen falsa es imposible decidir. Aquí ver
 * exactamente lo que se dibuja vale más que no repetirse: son nueve lineas.
 *
 * La geometría, para quien tenga que retocarlas: el eje de todas es la
 * diagonal de abajo-izquierda a arriba-derecha, con la punta en (21,8; 2,2).
 * La base de la hoja y la guarda son PERPENDICULARES a ese eje, y de ahí el
 * `rotate(-45)`: sin esa rotación la guarda se alinea con los ejes de la
 * caja y el icono deja de leerse como un arma.
 */

export function IconoFlorete(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja: la más fina de las tres, recta y de sección cuadrangular. */}
      <path d="M21.8 2.2 11.4 14.8 9.2 12.6Z" fill="currentColor" />
      {/* Coquille: disco pequeño, del tamaño de la palma. */}
      <ellipse
        cx="9.3"
        cy="14.7"
        rx="1.5"
        ry="3.4"
        transform="rotate(-45 9.3 14.7)"
        fill="currentColor"
      />
      {/* Empuñadura francesa y pomo. */}
      <path
        d="M7.9 16.1 4 20"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="3.1" cy="20.9" r="1.4" fill="currentColor" />
    </Svg>
  );
}

export function IconoEspada(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja más gruesa: la espada pesa más y su sección es triangular. */}
      <path d="M21.8 2.2 13.6 13.3 10.9 10.6Z" fill="currentColor" />
      {/*
        Cazoleta: honda y del doble de anchura que la coquille. La mano es
        blanco válido en espada y hay que protegerla, y esa diferencia de
        tamaño es lo único que hay que mirar para no confundirlas.
      */}
      <path
        d="M4.2 14.2a6.2 2.7 0 0 1 12.4 0z"
        transform="rotate(-45 10.4 14.2)"
        fill="currentColor"
      />
      <path
        d="M8.4 15.6 4.4 19.6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="3.5" cy="20.5" r="1.4" fill="currentColor" />
    </Svg>
  );
}

export function IconoSable(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja curva: el sable corta, y es la única de las tres que no es recta. */}
      <path
        d="M21.9 2.1c-4.1 1-7.7 3.1-10.8 6.4l2.3 2.3c2.9-3.3 5.6-5.6 8.5-8.7Z"
        fill="currentColor"
      />
      {/*
        Guarda de cesta: aro que va de la guarda al pomo envolviendo los
        nudillos. Hueco a propósito, para que no se confunda con la cazoleta
        maciza de la espada: es la única silueta hueca de las tres.
      */}
      <path
        d="M12.7 10.4c2.9 2.2 3.1 5.3.8 7.6-1.5 1.5-3.4 1.9-4.9 1.4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M11.6 9.3 4.3 19.7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="3.5" cy="20.6" r="1.4" fill="currentColor" />
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
