import { cn } from '@/lib/utils';

/**
 * La marca de la aplicación.
 *
 * ===========================================================================
 * LA FORMA, EN UNA FRASE
 * ===========================================================================
 *
 *   **Un florete entrando en la teja por la esquina de abajo, en diagonal, y
 *   cortado por el canto: el arma no cabe en la caja.**
 *
 * La razón de dibujo es una proporción, no un adjetivo. La diagonal de un
 * cuadrado mide 141 frente a 100 de lado, así que en diagonal cabe un 41 %
 * más de arma —es exactamente el argumento con el que están dibujados los
 * iconos de arma en `calendario/iconos-arma.tsx`—. Y aun así no cabe: un
 * florete son 90 cm de hoja y 12 de cazoleta. En vez de encogerlo hasta que
 * quepa (que es lo que convierte un arma en una mancha), **se corta**. El
 * corte es la marca: dice que lo que se ve es un trozo de algo más largo.
 *
 * Por qué eso no se lee como un visto bueno, que es el accidente nº 1 de la
 * lista de abajo y el que más caro sale aquí: el trazo es **de ancho
 * constante** —no se afina desde la guarda— y la coquille es un canto
 * **simétrico a los dos lados** de la hoja. Un visto es una masa que se
 * afina y un travesaño de un solo lado. Comprobado en la captura, no
 * deducido.
 *
 * ---------------------------------------------------------------------------
 * DE QUÉ FAMILIA ES
 * ---------------------------------------------------------------------------
 *
 * De la de `src/components/calendario/iconos-arma.tsx`, que es el dibujo del
 * usuario y el lenguaje de formas de la casa. Se cumplen sus cuatro reglas:
 *
 *  - **Caja de 100** y **trazo 8**, que es el peso 2/24 de Lucide: a 28 px la
 *    marca pesa lo mismo que cualquier otro icono de la pantalla. El 5,333
 *    escrito abajo es ese 8 dividido por el `scale(1.5)` del grupo.
 *  - **Diagonal, punta arriba a la derecha.**
 *  - **De trazo, no de masa rellena**, y sin círculos de remate: el remate
 *    redondo de la punta hace de botón del florete, como en el icono el
 *    remate hace de pomo.
 *  - **La guarda es perpendicular a la hoja.** Es lo que hace que un trazo
 *    con un bulto se lea como un arma y no como un palo (fallo nº 5 de
 *    `iconos-arma.tsx`).
 *
 * Dos cosas se salen de la familia a propósito, y las dos están medidas:
 *
 *  1. **La coquille va de semiancho 12 y no 9.** Con el 9 del icono, a 28 px
 *     —que es el tamaño de la cabecera— el canto desaparece y queda una raya
 *     inclinada. Con 12 se sigue viendo el travesaño. Es la misma corrección
 *     que se le hizo a la campana de la espada por el mismo motivo.
 *  2. **La empuñadura acaba en corte recto** (`butt`), no en remate redondo.
 *     El remate redondo se probó: queda un pomo bonito y correcto, pero
 *     entonces el arma **cabe** dentro de la teja y la marca vuelve a ser «un
 *     icono metido en una caja». El corte es lo que la hace una composición.
 *
 * Y el campo de color: la marca lleva teja y los iconos de arma no. Es la
 * diferencia normal entre un logotipo y un icono de interfaz, y aquí hace
 * falta por la razón del apartado siguiente. También es lo que separa la
 * marca del icono de FLORETE del filtro de armas, que sí significa «florete»
 * y va desnudo, en el color del texto.
 *
 * España es **una pizca y va en el color**: el rojo de la bandera
 * (`--primary`, `#c60c1e`, que es prácticamente el Pantone 186C de pantalla
 * que pide `REFERENCIAS.md`). Ni bandera, ni franjas, ni el oro, que está
 * reservado a las convocatorias. Dos masas planas: sin degradado, sin brillo
 * y sin sombra.
 *
 * Medido, que es lo que exige el proyecto para cualquier par de colores:
 *
 *   blanco sobre el rojo de la teja     5,89:1   ← es lo que lleva el dibujo
 *   el rojo sobre `--background`        3,17:1   pasa el 3:1 de gráfico
 *   el rojo sobre `--card`              2,91:1   **no** llega al 3:1
 *
 * O sea: **la marca no se pone sobre `--card`**. Ahí el canto de la teja se
 * difumina contra la superficie. En la aplicación va sobre `--background`
 * (cabecera) y sobre la fotografía de la pantalla de acceso, y en las dos el
 * contraste que importa es el del dibujo contra su propia teja.
 *
 * El radio de la teja es 21,7 sobre 100, que son **6 px a los 28 px** de la
 * cabecera: el `--radius` estructural de la aplicación, no el redondeo de
 * 12 px que llevan por defecto todas las interfaces generadas.
 *
 * ---------------------------------------------------------------------------
 * LO QUE PASA A 16 px, DICHO SIN ADORNOS
 * ---------------------------------------------------------------------------
 *
 * **A 16 px esto no es un florete: es una teja roja con un trazo blanco en
 * diagonal.** El travesaño mide un píxel y se funde con la hoja. Está
 * elegido así y no es una concesión disimulada:
 *
 *   Un arma de esgrima entera NO CABE en 16 px. La hoja del florete es 90 cm
 *   y la cazoleta 12: reducida a una caja de 16 px, la hoja mide un píxel, y
 *   en cuanto se engorda para que se vea, la silueta cae en otra cosa que el
 *   ojo ya tiene aprendida. Eso son las trece rondas de la lista de abajo.
 *
 * Así que a 16 px la marca es **firma de color + una forma rotunda**, que es
 * lo que hace cualquier marca decente en la pestaña, y el arma se lee de
 * 28 px arriba. La prueba que decide está en el banco: la marca a 16 px
 * metida entre pestañas de aplicaciones de verdad, con sus favicons traídos
 * en vivo (Gmail, Drive, FIE, RFEE, GitHub, Wikipedia, YouTube). Se
 * distingue: es la única teja roja y el único trazo en diagonal de la fila.
 * El favicon de la RFEE, que está al lado, es un escudo ilegible a 16 px;
 * ese es el listón que había que superar y se supera.
 *
 * ===========================================================================
 * EL BANCO, Y LAS TREINTA Y TRES FORMAS QUE YA ESTÁN DESCARTADAS
 * ===========================================================================
 *
 *   npm run marca
 *      → capturas/marca.png             lo que se publica: 16/20/28/32/64/180
 *                                       sobre fondo, superficie y claro, en
 *                                       monocromo por los dos lados, en la
 *                                       cabecera y entre pestañas de verdad
 *      → capturas/marca-1x.png          lo mismo sin retina, que es donde un
 *                                       trazo de 1,3 px se puede caer
 *      → capturas/marca-descartadas.png las treinta y tres, dibujadas
 *
 * **No repitas ninguna de estas.** Cada línea es una ronda de capturas ya
 * pagada, y lo que va escrito es en qué se convirtió la idea al renderizarla,
 * que nunca es lo que parecía sobre el papel.
 *
 * Las trece primeras, de cuando se buscaba dibujar un arma:
 *
 *    1. Hoja en diagonal que se afina desde la guarda → un VISTO BUENO.
 *       Fatal: aquí un visto significa «inscripción aceptada».
 *    2. La misma con la cazoleta de lente → un PÁJARO; dentro de un escudo,
 *       una HOJA DE ÁRBOL.
 *    3. Arma horizontal con la guarda alineada con los ejes → un BANDERÍN; y
 *       con el puño, un AVIÓN.
 *    4. El saludo, arma vertical y cazoleta cerrada → otro AVIÓN visto desde
 *       arriba, y a 16 px una CRUZ.
 *    5. Hoja atravesando la cazoleta de frente → SEÑAL DE PROHIBIDO.
 *    6. Cazoleta sola de perfil → una D.
 *    7. Careta de frente y de perfil → CAMPANA de notificaciones, BUZÓN y
 *       RADIADOR, según el ancho.
 *    8. Escudo con faja → nitidísimo a 16 px y heráldica genérica: cero
 *       esgrima.
 *    9. Faja diagonal en la teja → rotunda y muy «Apple», pero es una raya en
 *       una caja: no significa nada.
 *   10. Hoja hasta el borde de la teja → a 180 px, un TACHÓN, como un fallo
 *       de pintado.
 *   11. Punta con afilado largo → una AGUJA, y el conjunto una flecha.
 *   12. La E de Esgrima con el brazo del medio convertido en hoja → aguantaba
 *       16 px, y era «una letra en un cuadrado redondeado», que es el logo
 *       más de plantilla que existe. Es la que el usuario rechazó.
 *   13. Dos trazos cruzados en aspa → no dice esgrima, dice CERRAR.
 *
 * Y veinte más de esta vuelta, buscando el calendario y la pista, que son las
 * dos vías que faltaban. **El hallazgo de esta ronda es que la caja es el
 * problema**: el rectángulo redondeado es la forma más sobrecargada de la
 * iconografía —tarjeta, nota, ventana, imagen, batería, interruptor— y
 * cruzarla con una diagonal da un visto bueno casi siempre.
 *
 *   El vocabulario del calendario
 *   14. Celda de día + hoja dentro → un VISTO BUENO EN UNA CASILLA.
 *   15. Teja con banda de cabeza + hoja en negativo → el mismo visto bueno,
 *       y a 180 px una FIRMA sobre una raya.
 *   16. Celda + hoja escapándose por la esquina → una CESTA CON ASA, o una
 *       SARTÉN.
 *   17. Celda girada 45° (rombo) + hoja → una COMETA; en pequeño, el ROMBO DE
 *       SEÑAL de peligro.
 *   18. Silueta de calendario (cuerpo + banda de cabeza separada) → una
 *       BANDEJA CON TAPA, y a 28 px el hueco parece una GRIETA.
 *   19. Rejilla del mes de 2×2 con un día relleno → se lee perfecta hasta
 *       16 px y es el icono de REJILLA DE APLICACIONES. Cero esgrima. (Sirve
 *       para saber que cuatro celdas separadas sí sobreviven a 16 px.)
 *   20. Rejilla del mes en tenue detrás del arma → un DOBLEZ, y a 32 px
 *       SUCIEDAD.
 *   21. Los días como cinco puntos en el canto de abajo → PUNTOS DE CARGA,
 *       los «…» de «escribiendo».
 *   22. El día como un cuadrado suelto al que llega la punta → una ESPADA CON
 *       UN CUADRO SUELTO; en pequeño, un icono de ENVIAR.
 *   23. Solo la teja y la banda de cabeza → un BOTÓN DE QUITAR (el menos).
 *   24. La teja con una muesca en el canto de arriba → un MORDISCO.
 *   25. La teja con una esquina recta y tres redondas → un DESCONCHÓN; parece
 *       un fallo de pintado.
 *
 *   La pista
 *   26. Banda con línea media y las dos de puesta en guardia → una BATERÍA.
 *       Inconfundible.
 *   27. Banda con la línea media sola → un INTERRUPTOR de dos celdas.
 *       Con tres, el icono de COLUMNAS.
 *   28. La banda en diagonal con su línea media → una TIRITA.
 *   29. La pista en perspectiva (trapecio) con la línea media → una
 *       CARRETERA.
 *   30. Hoja y filete sin caja (el arma de pie sobre la línea) → un ASPA
 *       CAÍDA, y a 16 px un garabato.
 *
 *   Sobre el arma ya elegida
 *   31. La campana de la espada en lugar de la coquille → a 180 px una «Q»;
 *       el aro en perspectiva girado 45° se cierra sobre sí mismo.
 *   32. Hoja doblada, como en el tocado → un BASTÓN, o un ANZUELO.
 *   33. Recortada por los dos cantos, solo el fragmento de hoja → una BARRA
 *       INCLINADA: el tachón del nº 10 otra vez.
 *
 * Y una que no es un accidente de forma sino de contraste: **el florete en
 * rojo sin teja** (trazo `--primary` sobre el grafito) es más fino y más
 * elegante a 180 px, pasa el 3:1 de gráfico no textual (3,17:1) y **a 16 px
 * desaparece**: en la pestaña queda un arañazo. Por eso la marca lleva campo
 * de color.
 */

/**
 * La teja: cuadrado rojo con el radio estructural de la aplicación.
 *
 * 21,7 sobre 100 son 6 px a los 28 px de la cabecera, que es `--radius`.
 */
const TEJA =
  'M0 21.7 A21.7 21.7 0 0 1 21.7 0 H78.3 A21.7 21.7 0 0 1 100 21.7 ' +
  'V78.3 A21.7 21.7 0 0 1 78.3 100 H21.7 A21.7 21.7 0 0 1 0 78.3 Z';

/*
 * El arma va escrita **en vertical**, con la punta arriba, igual que en
 * `iconos-arma.tsx`, y el giro lo pone el grupo. Se mantiene así a propósito:
 * son números redondos y se pueden comparar línea a línea con el dibujo del
 * usuario. Y van sueltas, sin ayudantes que las calculen, porque el banco de
 * pruebas las saca de este fichero para pintar exactamente lo que se publica.
 */

/** La hoja. El remate redondo hace de botón de la punta. */
const HOJA = 'M50 13 V65';

/** La cúpula de la coquille: un canto bombeado, que es lo que se ve de frente. */
const CUPULA = 'M39 66 C 39 63.5 61 63.5 61 66';

/** El canto de la coquille. Semiancho 12 (el icono lleva 9): ver cabecera. */
const CANTO = 'M38 66 H62';

/**
 * La empuñadura, que **no cabe**: acaba a 61 unidades del centro y el canto
 * de la teja está a 61,7, así que el corte queda justo dentro por cuatro
 * décimas. Va con remate recto, no redondo, o el arma cabría en la caja.
 */
const EMPUNADURA = 'M50 67 V84';

/**
 * Giro y escala, en un solo sitio.
 *
 * El escalado centrado en (50,50) sería `translate(-25 -25) scale(1.5)`,
 * porque 50 × 1,5 − 25 = 50. El −15 en vez del −25 corre el arma 10 unidades
 * **por su propio eje, hacia la empuñadura**: así la punta gana sitio arriba
 * a la derecha y el corte cae justo en la esquina de abajo a la izquierda.
 * Si cambias `scale`, cambia `TRAZO` con él.
 */
const GIRO = 'rotate(45 50 50) translate(-25 -15) scale(1.5)';

/** Trazo 8 sobre caja de 100, dividido por el `scale` del grupo: 8 / 1,5. */
const TRAZO = '5.333';

/**
 * La marca, para cualquier sitio de la interfaz.
 *
 * El tamaño lo pone quien la usa con una clase de caja (`size-7` en la
 * cabecera y en la pantalla de acceso). Va con `aria-hidden` por defecto
 * porque al lado siempre está la palabra «CalendarFencing»: leerla dos veces sobra.
 * Si alguna vez va sola, se le pasa `titulo`.
 */
export function Marca({
  className,
  titulo,
}: {
  className?: string;
  titulo?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('shrink-0 text-primary-foreground', className)}
      role={titulo ? 'img' : undefined}
      aria-hidden={titulo ? undefined : true}
      aria-label={titulo}
    >
      {titulo ? <title>{titulo}</title> : null}
      <path d={TEJA} className="fill-primary" />
      <g
        transform={GIRO}
        fill="none"
        stroke="currentColor"
        strokeWidth={TRAZO}
        strokeLinejoin="round"
      >
        <g strokeLinecap="round">
          <path d={HOJA} />
          <path d={CUPULA} />
          <path d={CANTO} />
        </g>
        <path d={EMPUNADURA} strokeLinecap="butt" />
      </g>
    </svg>
  );
}
