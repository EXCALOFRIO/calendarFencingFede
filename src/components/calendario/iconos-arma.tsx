import { cn, WEAPON_LABEL, WEAPON_SHORT } from '@/lib/utils';
import type { Weapon } from '@/lib/queries/calendar';

/**
 * Iconos de las tres armas de esgrima.
 *
 * ===========================================================================
 * LA REGLA, ANTES QUE NADA
 * ===========================================================================
 *
 *   **De 22 px arriba va el dibujo. Por debajo va la abreviatura.**
 *
 * `IconoArma` para lo primero (tarjetas del calendario, cabecera de la ficha,
 * selectores de arma, leyendas). `EtiquetaArma` para lo segundo (barras
 * estrechas del mes, listas densas). No es una preferencia: está medido, y la
 * captura que lo demuestra es `capturas/iconos-comparar.png`.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTÁN ASÍ, Y NO DE LAS OTRAS CINCO FORMAS QUE SE PROBARON
 * ---------------------------------------------------------------------------
 *
 * Seis veces se ha dibujado esto. Hay dos bancos de pruebas porque las cinco
 * primeras versiones se dieron por buenas mirándolas a 48 px:
 *
 *   `node tests/ui/iconos.mjs`           → capturas/iconos.png
 *      el icono que hay AHORA, a 12/14/16/18/22/24/32/64 px y dentro de una
 *      barra de mes y de una tarjeta de competición de verdad.
 *
 *   `node tests/ui/iconos-comparar.mjs`  → capturas/iconos-comparar.png
 *      las variantes enfrentadas. Es el que hay que tocar para proponer otro
 *      dibujo: si no se ve mejor ahí, no se cambia.
 *
 * Lo que se aprendió, en orden:
 *
 * 1. **Verticales, con trazo fino**: las tres eran «una rayita con un bulto».
 * 2. **Verticales, con la guarda rellena**: la espada se leía como un
 *    paraguas y el sable como un «6».
 * 3. **Diagonales, con la hoja rellena**: ganaron masa y se distinguían, pero
 *    el florete parecía un cometa.
 * 4. **Horizontales**: el mejor reparto del espacio, pero la guarda seguía
 *    **alineada con los ejes**, así que la espada parecía una bandera.
 * 5. **La guarda tiene que ser perpendicular a la hoja.** Es lo que hace que
 *    un trazo con un bulto se lea como un arma.
 *
 * 6. Y esta, que es el dibujo del usuario y es mejor que las cinco anteriores
 *    porque es anatómicamente correcto: coquille plana en el florete, campana
 *    honda en la espada, guardamanos en D en el sable. Cumple el punto 5 por
 *    construcción. Lo que se ha medido encima de su propuesta:
 *
 *    - **El trazo.** Venía en 2 sobre una caja de 100, que a 16 px de pantalla
 *      son 0,32 px: invisible de 12 a 22 px. Va en **8**, que no es un número
 *      elegido a ojo: 8 en caja de 100 es exactamente el 2 en caja de 24 de
 *      Lucide, así que el arma pesa lo mismo que cualquier otro icono de la
 *      aplicación a cualquier tamaño.
 *    - **La diagonal.** La diagonal de la caja mide 141 y el lado 100, así que
 *      girando 45° el arma cabe un 30 % más grande —y con ella la guarda, que
 *      es lo único que distingue las tres—. Medido: a 22 px las tres se
 *      separan en diagonal y no se separan en vertical. La punta va **arriba a
 *      la derecha**, que es la dirección del `Sword` de Lucide.
 *    - **La punta no es un círculo.** Con trazo 8 el remate redondo ya mide 4
 *      unidades de radio, más que el círculo de 1,5 que llevaba dentro. Lo
 *      mismo los pomos: estaban escondidos dentro del propio trazo. Fuera los
 *      cinco círculos.
 *    - **La campana de la espada, más honda.** Su cúpula volaba 8 unidades
 *      sobre el aro y con trazo 8 los dos trazos se tocaban: quedaba un
 *      borrón. Vuela 24, y entonces **queda un hueco cerrado dentro de la
 *      campana**. Ese hueco es lo que se ve a 22 px y lo que impide confundir
 *      la espada con el florete. Se probó cerrarla con una cuerda recta y
 *      volvía el fallo nº 4: parecía un banderín (`iconos-campanas`).
 *    - **El sable, una pieza menos.** Su guardamanos empezaba con una curva
 *      que repetía la cruz. Quitada.
 *
 * Lo que distingue a cada arma —y es lo único que las distingue de verdad,
 * también en la realidad— es la guarda:
 *
 *   FLORETE   coquille pequeña y plana, del tamaño de la palma. Un canto.
 *   ESPADA    campana grande y honda: la mano es blanco válido y hay que
 *             protegerla. Es la única con un hueco cerrado.
 *   SABLE     guardamanos en D: baja de la cruz al pomo envolviendo los
 *             nudillos, porque el sable corta. Es la única asimétrica.
 *
 * Canto / hueco cerrado / lazo asimétrico: tres cosas distintas. Eso se lee a
 * 22 px; un detalle de contorno, no.
 *
 * Se dibujan a mano porque ninguna librería de iconos (Lucide, que es la que
 * usa esta aplicación, Tabler, Heroicons, Material) trae las tres armas de
 * esgrima por separado: todas tienen una «espada» genérica, y aquí eso no
 * distingue nada.
 */

type Props = { className?: string; title?: string };

/**
 * La caja, el trazo y el giro, en un solo sitio.
 *
 * El `transform` hace tres cosas y en este orden: gira 45° alrededor del
 * centro, y estira el dibujo 1,3 veces desde ese mismo centro
 * (`translate(-15 -15) scale(1.3)` es un escalado centrado en 50,50, porque
 * 50 × 1,3 − 15 = 50).
 *
 * Y de ahí sale el 6,15 del trazo, que si no parece un número raro: el grupo
 * multiplica por 1,3 todo lo que hay dentro, el trazo incluido, así que
 * **6,15 × 1,3 = 8**, que es el peso que se decidió. Si cambias `scale`,
 * cambia el trazo con él.
 */
function Svg({ className, title, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="6.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-full', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <g transform="rotate(45 50 50) translate(-15 -15) scale(1.3)">{children}</g>
    </svg>
  );
}

/**
 * Los trazos van ESCRITOS, sin ayudantes que los calculen.
 *
 * Se intentó con dos componentes, `Hoja` y `Puno`, para no repetir. Pero los
 * bancos de pruebas sacan los trazos del fichero con una expresión regular y
 * no expanden componentes, así que pintaban iconos a los que les faltaba la
 * hoja y el puño, y sobre esa imagen falsa es imposible decidir. Aquí ver
 * exactamente lo que se dibuja vale más que no repetirse: son once líneas.
 *
 * Las coordenadas son **verticales**, con la punta arriba, tal y como las
 * escribió el usuario. El giro lo pone el grupo de `Svg`. Se mantienen así a
 * propósito: son números redondos y se pueden comparar con su propuesta línea
 * a línea.
 */

export function IconoFlorete(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja: la más fina de las tres, recta y de sección cuadrangular. */}
      <line x1="50" y1="13" x2="50" y2="65" />
      {/* Coquille: disco plano del tamaño de la palma, visto de canto. La
          curva y el canto quedan pegados a propósito: juntos son un canto
          bombeado, que es lo que se ve de una coquille de frente. */}
      <path d="M 42 66 C 42 63.5 58 63.5 58 66" />
      <line x1="41" y1="66" x2="59" y2="66" />
      {/* Empuñadura francesa. El remate redondo del trazo hace de pomo. */}
      <line x1="50" y1="67" x2="50" y2="85" />
    </Svg>
  );
}

export function IconoEspada(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja: más corta que la del florete porque la campana ocupa más. */}
      <line x1="50" y1="12" x2="50" y2="52" />
      {/* Campana honda. El vuelo es de 24 unidades para que quede un HUECO
          cerrado entre la cúpula y el aro: es lo único que se sigue viendo a
          22 px y lo que impide confundirla con el florete. */}
      <path d="M 31 65 C 31 41 69 41 69 65" />
      {/* El aro, en perspectiva. Es lo que la hace leer como una cazoleta y no
          como una forma plana; sin él la campana parece un banderín. */}
      <ellipse cx="50" cy="67" rx="19" ry="4" />
      <line x1="50" y1="71" x2="50" y2="87" />
    </Svg>
  );
}

export function IconoSable(props: Props) {
  return (
    <Svg {...props}>
      {/* Hoja curva con la punta vuelta: el sable corta, y es la única de las
          tres que no acaba en punta de estoque. */}
      <path d="M 45 14 C 45 11 48 11 48 14 L 46.5 17 L 46.5 61" />
      {/* Cruz. */}
      <line x1="34" y1="64" x2="57" y2="64" />
      <line x1="46.5" y1="66" x2="46.5" y2="86" />
      {/* Guardamanos en D: de la cruz al pomo, envolviendo los nudillos. Es la
          única silueta asimétrica de las tres, y eso se ve antes que cualquier
          detalle de contorno. */}
      <path d="M 57 64 C 68 72 66 83 46.5 86" />
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

/**
 * El arma por debajo de 22 px: FLO / ESP / SAB.
 *
 * Aquí no va dibujo, y no por pereza. La causa es geométrica: en una silueta
 * de arma lo único que separa las tres es la guarda, y a 14 px la guarda mide
 * tres píxeles. El banco lo enseña en la sección «En la barra del mes»:
 * a la izquierda tres dibujos que son la misma mancha, a la derecha FLO, ESP y
 * SAB perfectamente legibles al mismo tamaño de letra.
 *
 * Va **sin recuadro**, en negrita y con el color del texto que la rodea. Dos
 * motivos, los dos medidos:
 *
 *  - En la barra del mes ya hay un recuadro al lado con el género («M», «F»).
 *    Dos recuadros seguidos se leen como una sola cosa; abreviatura desnuda
 *    contra letra enmarcada se distinguen de un vistazo.
 *  - Y tres letras, no una: «F» de florete pegada a «F» de femenino es una
 *    trampa. Por eso FLO/ESP/SAB y no F/E/S.
 *
 * Es un `<abbr>` de verdad, con el nombre completo en `title`, porque es
 * exactamente eso: una abreviatura con su desarrollo.
 */
export function EtiquetaArma({
  arma,
  className,
}: {
  arma: Weapon;
  className?: string;
}) {
  return (
    <abbr
      title={WEAPON_LABEL[arma]}
      className={cn(
        'shrink-0 font-bold uppercase tracking-tight no-underline',
        className,
      )}
    >
      {WEAPON_SHORT[arma]}
    </abbr>
  );
}

/** Por debajo de esto no se pinta dibujo. Medido, no elegido. */
export const UMBRAL_DIBUJO = 22;

/** Orden fijo: siempre florete, espada, sable. El del reglamento. */
const ORDEN: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];

/**
 * Las armas de una competición, resueltas solas: dibujo o abreviatura según
 * el sitio que haya.
 *
 * Existe para que nadie tenga que acordarse de la regla ni volver a medirla.
 * Se le dicen las armas y **cuántos píxeles hay para el arma en ese sitio** —el
 * alto útil de la barra, el hueco de la tarjeta— y elige:
 *
 *   <MarcaArma armas={['ESPADA']} px={28} />            → el dibujo, a 28 px
 *   <MarcaArma armas={['FLORETE', 'ESPADA']} px={14} /> → FLO ESP
 *
 * El tamaño va como número y no como clase de Tailwind a propósito: el umbral
 * y lo que se pinta tienen que salir del mismo dato, o se desacoplan y volvemos
 * a tener iconos invisibles en las barras.
 *
 * Y las abreviaturas son de TRES letras, no la inicial. Hubo una propuesta de
 * inicial única —F, E, S— y se lee, pero choca dos veces, y las dos están en
 * la captura (`capturas/iconos-abreviatura.png`):
 *
 *   «F» de florete pega con «F» de femenino, que es el marcador de al lado en
 *   la misma barra: sale «F F TNR de Alicante».
 *   «ES» de espada + sable es el código ISO de España, que esta aplicación
 *   usa de verdad para los países (`src/components/bandera.tsx`).
 */
export function MarcaArma({
  armas,
  px,
  className,
}: {
  armas: Weapon[];
  /** Píxeles disponibles para la marca. Decide dibujo o abreviatura. */
  px: number;
  className?: string;
}) {
  const presentes = ORDEN.filter((a) => armas.includes(a));
  if (presentes.length === 0) return null;

  if (px < UMBRAL_DIBUJO) {
    return (
      <span className={cn('inline-flex shrink-0 items-baseline gap-1', className)}>
        {presentes.map((a) => (
          <EtiquetaArma key={a} arma={a} />
        ))}
      </span>
    );
  }

  /*
    Cada dibujo va con su nombre accesible, siempre. En una barra o en una
    tarjeta el dibujo es lo ÚNICO que dice el arma, así que sin nombre quien
    use un lector de pantalla no se enteraría; y si la palabra ya está escrita
    al lado, oírla dos veces es un ruido menor comparado con no oírla nunca.
  */
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      {presentes.map((a) => (
        <span key={a} className="inline-flex" style={{ width: px, height: px }}>
          <IconoArma arma={a} title={WEAPON_LABEL[a]} />
        </span>
      ))}
    </span>
  );
}
