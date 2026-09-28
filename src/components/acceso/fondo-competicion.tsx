/**
 * Fondo de competición de la pantalla de acceso.
 *
 * Fotografías de los equipos españoles de florete —masculino y femenino— en el
 * Campeonato del Mundo de Hong Kong. Se monta con una línea al final de
 * `<main>` en `src/app/entrar/page.tsx` y no pide nada a cambio: ni props, ni
 * estado, ni cliente.
 *
 * ===========================================================================
 * PROCEDENCIA: ESTE ES EL ÚNICO SITIO DONDE LA APLICACIÓN REHOSPEDA UNA FOTO
 * ===========================================================================
 * Y hay que decirlo aquí porque la regla de la casa es la contraria: las fotos
 * de tirador de la FIE se ENLAZAN a `static.fie.org` y no se copian nunca —ver
 * `fotoFieAncho` en `src/lib/ingest/sources/fie-tiradores.ts`—, precisamente
 * porque sus términos no permiten almacenar su contenido.
 *
 * Estas nueve fotos viven en `public/fotos/` y las sirve nuestro dominio. Se
 * usan con la misma autorización verbal con la que se guarda el ranking de la
 * FIE: uso **interno**, detrás de sesión, sin monetizar, y el usuario dice
 * tenerla por escrito en un hilo de correo con un cargo directivo de la FIE
 * que además lo es de la federación española. No consta aquí ni el autor de
 * las fotografías ni una licencia concreta.
 *
 * Lo que eso implica, dicho sin rodeos: **si estas imágenes tienen autor y hay
 * que acreditarlo, o si el permiso no las cubre, el sitio donde se arregla es
 * este componente y la carpeta `public/fotos/`**, y son cinco minutos. Lo que
 * no se puede es dar por hecho que están cubiertas porque llevan meses
 * puestas.
 *
 * ===========================================================================
 * LAS DOS REGLAS QUE DECIDEN TODO ESTO
 * ===========================================================================
 *
 * 1. **Los originales miden 1170 px de ancho y no hay más.** Así que hay
 *    exactamente dos formas honestas de usarlos:
 *      - **nítidos**, solo en huecos MÁS PEQUEÑOS que el original (los
 *        paneles de la tira miden 177-317 px de CSS, de sobra incluso en una
 *        pantalla de densidad 3);
 *      - **a sangre**, solo desenfocados, donde la resolución ya no importa
 *        porque no queda detalle que mirar.
 *    Una foto de 1170 px estirada nítida a un escritorio de 1440 se ve
 *    blanda, y se nota. No se hace en ningún sitio de este componente.
 *
 * 2. **El formulario tiene que seguir leyéndose.** El texto secundario del
 *    tema (`--muted-foreground`, ≈ #adaeb6) necesita que lo que haya debajo
 *    no pase de #424242 para llegar a 4,5:1. Las zonas blancas de estas
 *    fotos llegan a #e6e6e6, así que donde hay texto secundario encima el
 *    velo tiene que dejar la foto al 20 %. Eso es mucho velo, y por eso la
 *    foto NÍTIDA se pone donde no hay ni una letra, y solo la desenfocada
 *    convive con el texto. Medido con `tests/ui/acceso.mts`, que mira los
 *    píxeles del fondo debajo de cada línea.
 *
 * ===========================================================================
 * LA COMPOSICIÓN
 * ===========================================================================
 *
 * **Escritorio (a partir de 1024 px).** La pantalla ya está partida en dos
 * columnas (1,1fr / 1fr) con un filete vertical en medio. Esa partición se
 * aprovecha tal cual: la columna de la presentación se vuelve fotográfica y
 * la del formulario se queda lisa. Es la razón de que el formulario se lea
 * perfecto sin pelearse con nada: **no tiene una foto debajo**. Dos capas:
 *
 *   1. **Atmósfera**, a sangre en esa columna: una sola foto con desenfoque
 *      suave, oscurecida con tres velos del color del fondo.
 *   2. **Tira de tres fotos nítidas** en el hueco vacío que hay entre la
 *      marca y el titular —598 px de alto medidos, no estimados—, a sangre
 *      por el borde izquierdo y cortada en seco por el filete de la columna.
 *      Tira, no tarjetas: tres paneles pegados y separados por filetes de un
 *      píxel, que es la estructura de esta aplicación (`UI.md`, §3 bis). Los
 *      anchos son desiguales a propósito —42 / 32 / 26— y cada foto va en el
 *      panel cuya forma le conviene: las dos estocadas, horizontales, en los
 *      anchos; el primer plano, vertical, en el estrecho.
 *
 * **Móvil.** No hay atmósfera desenfocada, y no es un olvido: está explicado
 * más abajo, donde iba. Hay dos fotos nítidas, que es lo que de verdad se
 * puede ver en una pantalla de 393 px:
 *
 *   1. **Cabecera** a sangre detrás de la marca y del titular. Va anclada al
 *      documento, no a la ventana, para que ruede con el texto; ese detalle
 *      es lo que hace posible que esté ahí.
 *   2. **Tira al pie de la página**, después del formulario, con dos fotos
 *      grandes y un pie que dice de dónde son. Al final y no al principio
 *      para no empujar el campo del correo fuera de la primera pantalla.
 *
 * **Los dos equipos salen en los dos tamaños.** Es la selección española
 * entera; una portada con solo hombres estaría mal. En escritorio el panel
 * más ancho de la tira es el del equipo femenino y la atmósfera también; en
 * móvil, una de las dos fotos del pie.
 *
 * ===========================================================================
 * CÓMO SE SIRVEN
 * ===========================================================================
 *
 * Con `background-image` de CSS sobre `<div>` decorativos, no con
 * `next/image` ni con `<img>`. Tres razones, en orden de peso:
 *
 * 1. **Cloudflare.** Esto no se despliega en Vercel: va en Workers con
 *    `@opennextjs/cloudflare`, y ahí `/_next/image` lo atiende el Worker —una
 *    invocación más una transformación del binding `IMAGES` por variante—,
 *    mientras que los ficheros de `public/` los sirve la red de Cloudflare
 *    desde `.open-next/assets` sin tocar el Worker. Esta es la única pantalla
 *    que ve alguien sin sesión, o sea la más pedida: aquí eso son cuatro
 *    invocaciones menos por visita. (De paso, para quien venga a poner un
 *    `<Image>`: en Next 16 `priority` está **obsoleto** en favor de
 *    `preload`.)
 * 2. **Solo se descarga lo que se ve.** Un `<img>` escondido con `lg:hidden`
 *    se descarga igual; el `background-image` de un elemento en
 *    `display: none`, no. Comprobado contando respuestas de red en
 *    `tests/ui/acceso.mts`: el móvil se trae 131 kB en tres ficheros, el
 *    escritorio 184 kB en cuatro, y una ventana baja —donde la tira no
 *    cabe— solo 17 kB. Ninguno se trae los del otro.
 * 3. **Son decorativas.** Una foto de ambiente sin información no lleva
 *    `alt`; lo correcto es que no esté en el árbol de accesibilidad. La tira
 *    del pie del móvil sí dice lo que es, y por eso va en un `<figure>` con
 *    su `<figcaption>` de verdad.
 *
 * Los derivados los genera `scripts/fotos-acceso.mjs` (con el Chromium de
 * Playwright, sin dependencias nuevas) y el desenfoque va **cocido en el
 * fichero**: la atmósfera pesa 17 kB en vez de 141 y el navegador no
 * desenfoca nada en cada pintado.
 *
 * ===========================================================================
 * MOVIMIENTO
 * ===========================================================================
 *
 * Ninguno. Ni entrada, ni paralaje, ni Ken Burns lento. Una foto de fondo que
 * se mueve sola es justo el tic que hace que una pantalla parezca una
 * plantilla, y aquí no hay nada que comunicar con el movimiento. Al no haber
 * animación, tampoco hay nada que arreglar para `prefers-reduced-motion`.
 */

/**
 * Un panel de la tira.
 *
 * Las clases llegan enteras desde fuera en vez de componerse aquí con una
 * plantilla, porque Tailwind lee el código como texto: `bg-[image:url(${x})]`
 * no genera nada. Y `basis-0` con `grow-[n]` en lugar de anchos en
 * porcentaje, para que el filete de un píxel que separa los paneles salga del
 * reparto y no desborde la columna.
 */
function Panel({
  imagen,
  posicion,
  crecer,
}: {
  imagen: string;
  posicion: string;
  crecer: string;
}) {
  return (
    <div
      aria-hidden
      className={`min-w-0 basis-0 bg-cover bg-no-repeat ${crecer} ${posicion} ${imagen}`}
    />
  );
}

export function FondoCompeticion() {
  return (
    <>
      {/*
        Atmósfera. Fija a la ventana, detrás de todo y sin capturar ni un
        clic.

        El `-z-10` encaja con la textura del lienzo sin negociar nada: esa
        textura —las cuñas, la retícula y el grano de `globals.css`— es un
        `background-image` de `html`, y el fondo del elemento raíz se pinta
        por debajo de absolutamente todo, también por debajo de una capa con
        `z-index` negativo. O sea: textura abajo, fotos encima, contenido
        arriba, y ningún `z-index` que coordinar con nadie.

        Y las fotos no tapan la textura más que donde están: en escritorio
        ocupan solo la columna izquierda, así que la mitad del formulario se
        queda con la textura a la vista; en móvil, solo los primeros 198 px.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        {/* ---------------------------------------------------------------
            EN MÓVIL NO HAY ATMÓSFERA DESENFOCADA A SANGRE, Y ES UNA
            DECISIÓN, NO UN OLVIDO.

            Se probó: dos fotos desenfocadas cruzándose a media pantalla,
            fijas a la ventana. La página del móvil rueda casi 400 px, así que
            cualquier línea de texto puede acabar sobre cualquier parte de una
            capa fija y el velo tiene que ser uniforme al 80 % (la cuenta del
            punto 2 de la cabecera). Al 20 %, una foto desenfocada ya no es
            una foto: es grano. Se miró la captura y quedaba peor que el fondo
            liso —ni negro limpio ni fotografía—, así que fuera.

            Lo que sí hay en móvil son dos fotos NÍTIDAS, y las dos están
            fuera de esta capa fija justamente por eso: al ir con el
            documento, ruedan con el texto y se puede saber qué letra cae
            encima de cada una. Ver `CabeceraMovil` y la tira del pie.
            --------------------------------------------------------------- */}

        {/* ---------------------------------------------------------------
            ESCRITORIO: la columna de la presentación es la fotográfica.
            El 52,381 % es exactamente 1,1 / 2,1, el reparto de la rejilla de
            la pantalla, para que el borde de la foto caiga en el mismo filete
            que ya dibuja la página y no un píxel más allá.
            --------------------------------------------------------------- */}
        <div className="absolute inset-y-0 left-0 hidden w-[52.381%] lg:block">
          <div className="absolute inset-0 bg-[image:url(/fotos/acceso/atmosfera.webp)] bg-cover bg-[position:52%_34%]" />
          {/*
            Velos. Son tres capas y cada una responde a un texto concreto:

            - El general (42 %) baja la foto entera hasta que el blanco del
              uniforme deja de brillar más que el titular.
            - El de abajo la apaga del todo en el tercio inferior, que es
              donde caen el titular y —el caso difícil— la entradilla en
              `--muted-foreground`.
            - El de arriba, una banda corta, es solo para la marca.

            No es un degradado de adorno: es el color del fondo del tema a
            distintas opacidades. Los números salen de medir el contraste
            sobre los píxeles del fondo, no de probar hasta que pareciera
            bonito (`tests/ui/acceso.mts`).
          */}
          <div className="absolute inset-0 bg-background/42" />
          <div className="absolute inset-0 bg-gradient-to-t from-background from-24% via-background/75 via-52% to-transparent" />
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-background/70 to-transparent" />

          {/*
            La tira nítida, centrada en el hueco que queda entre la marca y
            el titular.

            El alto es `min(17.5rem, 30vh)` y solo aparece a partir de 760 px
            de ventana. Las dos cosas son la misma cuenta: el bloque del
            titular ocupa los últimos 226 px de la columna, así que para que
            la tira no lo toque hace falta que su mitad inferior quepa antes.
            A 800 px de alto (un portátil de 1280 × 800) salen 240 px de tira
            y 44 de aire; por debajo de 760 no sale la cuenta y la tira
            desaparece sola en vez de pisar el titular. Es una condición de
            SITIO, no de dispositivo, y por eso se pregunta por el alto.

            El encuadre de cada panel (`bg-[position:…]`) está elegido a
            tamaño real en una hoja de contactos, no a ojo:
            `capturas/hoja-paneles.png`. Es la diferencia entre un primer
            plano y una frente cortada.
          */}
          <div className="absolute inset-x-0 top-[44%] hidden h-[min(24rem,30vh)] -translate-y-1/2 gap-px overflow-hidden border-y border-border bg-border [@media(min-height:760px)]:flex">
            {/* Equipo femenino, y en el panel más ancho de los tres. */}
            <Panel
              imagen="bg-[image:url(/fotos/acceso/tira-femenino.webp)]"
              posicion="bg-[position:30%_40%]"
              crecer="grow-[42]"
            />
            {/* Estocada bajo las banderas de las naciones. */}
            <Panel
              imagen="bg-[image:url(/fotos/acceso/tira-banderas.webp)]"
              posicion="bg-[position:68%_18%]"
              crecer="grow-[32]"
            />
            {/* Primer plano: vertical, y por eso en el panel vertical. */}
            <Panel
              imagen="bg-[image:url(/fotos/acceso/tira-primer-plano.webp)]"
              posicion="bg-[position:62%_22%]"
              crecer="grow-[26]"
            />
          </div>
        </div>
      </div>

      {/*
        Cabecera del móvil.

        Una sola foto nítida, a sangre, detrás de la marca y del titular.

        `absolute` SIN antepasado posicionado, que es la pieza rara y la que
        hace que esto funcione: el bloque contenedor pasa a ser el bloque
        contenedor inicial, cuyo origen está en el principio del DOCUMENTO y
        no en la ventana. O sea que esta banda ocupa los primeros 198 px de la
        página, **rueda con el contenido** y se va hacia arriba antes de que
        la entradilla —14 px en color secundario, el texto más exigente de la
        pantalla— llegue a pisarla. Una capa `fixed` no puede hacer esto: se
        queda quieta y tarde o temprano tiene debajo cualquier línea.

        Y al estar fuera del flujo no empuja nada: el campo del correo y el
        botón siguen donde estaban, en la primera pantalla. Eso era la
        condición para que esta foto pudiera existir.

        Cuidado si algún día se le pone `transform`, `filter` o `contain` a
        `<main>` o a `<body>`: cualquiera de los tres crearía un bloque
        contenedor nuevo y esta banda pasaría a medir una ventana en vez de
        anclarse al documento.

        Los velos van de más a menos: arriba (donde está la marca, 16 px y
        por tanto texto normal) hace falta más; sobre el titular, que es
        grande, hace falta menos; y abajo se apaga del todo para entregar la
        página limpia a la entradilla.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[11rem] overflow-hidden lg:hidden"
      >
        <div className="absolute inset-0 bg-[image:url(/fotos/acceso/movil-cabecera.webp)] bg-cover bg-[position:50%_76%]" />
        <div className="absolute inset-0 bg-background/52" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/45 from-0% via-transparent via-38% to-background to-100%" />
      </div>

      {/*
        Tira del pie del móvil. Esta va en el flujo de la página, al final,
        después del formulario: es contenido, no decoración, y por eso lleva
        pie de foto. En escritorio no existe (`lg:hidden`), que es donde manda
        la tira de la columna izquierda.
      */}
      <figure className="flex flex-col gap-2 border-t px-6 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:hidden">
        {/*
          `content-visibility: auto` es el único «carga diferida» que existe
          para un fondo de CSS: mientras el navegador se salta el pintado de
          este bloque tampoco pide sus imágenes, y son 81 kB que están por
          debajo de la primera pantalla. `contain-intrinsic-size` va con él y
          no es opcional: sin decirle cuánto mide lo que se está saltando, la
          página cambia de alto al llegar aquí.
        */}
        <div className="flex h-40 gap-px overflow-hidden rounded-sm bg-border [contain-intrinsic-size:auto_10rem] [content-visibility:auto]">
          <Panel
            imagen="bg-[image:url(/fotos/acceso/movil-femenino.webp)]"
            posicion="bg-[position:30%_40%]"
            crecer="grow-[55]"
          />
          <Panel
            imagen="bg-[image:url(/fotos/acceso/movil-primer-plano.webp)]"
            posicion="bg-[position:62%_22%]"
            crecer="grow-[45]"
          />
        </div>
        {/*
          El nombre de la ciudad no se parte nunca: son dos palabras y a
          393 px, cortado en dos líneas, se leen como dos sitios.
        */}
        <figcaption className="text-xs text-muted-foreground">
          Los equipos españoles de florete en el Campeonato del Mundo de{' '}
          <span className="whitespace-nowrap">Hong Kong</span>.
        </figcaption>
      </figure>
    </>
  );
}
