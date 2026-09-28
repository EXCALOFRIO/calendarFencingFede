import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';

/**
 * Derivados de las fotos de Hong Kong para la pantalla de acceso.
 *
 *   node scripts/fotos-acceso.mjs
 *
 * -------------------------------------------------------------------------
 * POR QUÉ SE GENERAN A MANO Y NO CON `next/image`
 * -------------------------------------------------------------------------
 * Esto se despliega en Cloudflare Workers con `@opennextjs/cloudflare`. Ahí
 * `/_next/image` **lo atiende el Worker**: cada variante de cada foto es una
 * invocación del Worker más una transformación del binding `IMAGES` (5.000
 * únicas al mes en el plan). Los ficheros de `public/`, en cambio, los sirve
 * la red de Cloudflare desde `.open-next/assets` sin tocar el Worker y sin
 * coste. La pantalla de acceso es la única página que ve alguien sin sesión,
 * o sea la más pedida de la aplicación: que sus cinco imágenes sean estáticas
 * y no dinámicas es la diferencia entre cero invocaciones y cinco por visita.
 *
 * Y hay una segunda razón, que es la que de verdad decide: **el desenfoque se
 * cuece aquí**. Un `filter: blur(20px)` en CSS sobre una capa del tamaño de la
 * pantalla obliga al navegador a desenfocar 1,3 millones de píxeles en cada
 * pintado, y para eso además necesita la foto entera (137 kB). Desenfocada de
 * antemano a 512 px de ancho, la misma imagen pesa ~15 kB, se ve idéntica
 * —porque no hay detalle que perder— y el navegador no desenfoca nada.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ LOS TAMAÑOS SON ESTOS
 * -------------------------------------------------------------------------
 * Los originales miden 1170 px de ancho y no hay más. Así que:
 *
 * - **Nítidas** solo donde se pintan a un tamaño MENOR que el original. Los
 *   paneles de la tira miden como mucho 301 × 252 px de CSS; con `cover`
 *   eso pide 378 × 252 px de foto, que en una pantalla de densidad 2 son
 *   756 px reales. De ahí los 880 px de ancho de los derivados: hay margen y
 *   sigue siendo una reducción del original, nunca un aumento.
 * - **A sangre** solo desenfocadas y oscurecidas, que es donde da igual la
 *   resolución.
 *
 * No hace falta `sharp` ni ninguna dependencia nueva: el Chromium de
 * Playwright, que ya está instalado para las capturas, sabe redimensionar y
 * codificar WebP.
 */

const ORIGEN = 'public/fotos';
const DESTINO = 'public/fotos/acceso';

/**
 * `desenfoque` va en píxeles del derivado, no del original: al estirarlo a la
 * pantalla el desenfoque se estira con él. 4 px sobre 900 de ancho son unos
 * 6-7 px vistos en la columna de un escritorio de 1440.
 *
 * Ese número está medido y es el resultado de tirar el primer intento. Con
 * 7 px sobre 512 de ancho —unos 20 px vistos— las cinco fotos que se
 * probaron dejaban de ser fotografías: eran manchas blancas, que es el
 * aspecto por defecto de cualquier portada generada. A 6-7 px vistos la foto
 * sigue reconociéndose como esgrima —la careta, las banderas, el gesto— y el
 * desenfoque tapa igual de bien que solo haya 1170 px de original.
 * Desenfoque suave, no papilla.
 *
 * `capturas/hoja-atmosfera.png` es la segunda hoja de contactos, la de los
 * candidatos suaves, y es la que decidió cuál de las seis fotos se queda.
 */
const RECETAS = [
  /**
   * Atmósfera a sangre de la columna izquierda del escritorio.
   *
   * Es `femenino-fondo` y no ninguna de las masculinas por dos razones que
   * se vieron en la hoja: es la única cuyo sujeto se sigue leyendo como una
   * tiradora desenfocada en vez de como un borrón, y deja el equipo femenino
   * con dos papeles en la composición (aquí y en el panel ancho de la tira)
   * frente a dos del masculino.
   *
   * Descartadas ahí mismo: `llavador-arena` y `femenino-extension`, cuyo
   * centro recortado es techo negro y desaparecen; `estocada-grada-llena`,
   * que es grada y hace ruido detrás de la marca; y `estocada-banderas`, que
   * queda bien pero ya sale nítida en la tira y repetir el mismo fotograma
   * dos veces en la misma pantalla se nota.
   */
  { de: 'femenino-fondo.jpg', a: 'atmosfera.webp', ancho: 900, desenfoque: 4, saturacion: 0.9, calidad: 0.84 },

  /**
   * Tira nítida del escritorio. 880 px de ancho: el panel más grande mide
   * 317 px de CSS y con `cover` pide 477 px de foto, que en densidad 2 son
   * 954 px reales. 880 se queda algo por debajo de eso y muy por debajo del
   * original: reducción, nunca aumento. La diferencia entre 880 y 954 es un
   * 8 %, invisible; la diferencia entre 880 y los 1508 px que pediría una
   * foto a todo el ancho de la columna es la que se ve.
   */
  { de: 'femenino-estocada.jpg', a: 'tira-femenino.webp', ancho: 880, desenfoque: 0, saturacion: 1, calidad: 0.82 },
  { de: 'estocada-banderas.jpg', a: 'tira-banderas.webp', ancho: 880, desenfoque: 0, saturacion: 1, calidad: 0.82 },
  { de: 'primer-plano-esp.jpg', a: 'tira-primer-plano.webp', ancho: 880, desenfoque: 0, saturacion: 1, calidad: 0.82 },

  /**
   * Cabecera del móvil, a sangre.
   *
   * 393 px de CSS de ancho por 198 de alto; con `cover` eso son 393 × 259 px
   * de foto, que en un iPhone de densidad 3 son 1179 px reales: **justo los
   * 1170 del original**. Es decir, aquí y solo aquí la foto se aprovecha
   * entera. Se sirve a 1000 px, un aumento de 1,18 que a densidad 3 no se ve,
   * y ahorra 40 kB respecto a servir el original completo.
   *
   * Es `llavador-arena` porque es la única toma general de las nueve: un
   * recorte de 2:1 le sienta bien —banderas, los dos tiradores y la pista— y
   * a las demás las decapita. Y de paso entra en la pantalla el tirador cuya
   * ficha y cuyo ranking están en la aplicación.
   */
  { de: 'llavador-arena.jpg', a: 'movil-cabecera.webp', ancho: 1000, desenfoque: 0, saturacion: 1, calidad: 0.78 },

  /**
   * Tira del pie del móvil. El hueco es más pequeño —186 × 180 px de CSS, que
   * con `cover` piden 272 px de foto y 816 px reales en densidad 3— así que
   * 760 px bastan y ahorran 15 kB por foto respecto al panel del escritorio.
   * En un móvil, 30 kB son 30 kB.
   */
  { de: 'femenino-estocada.jpg', a: 'movil-femenino.webp', ancho: 760, desenfoque: 0, saturacion: 1, calidad: 0.8 },
  { de: 'primer-plano-esp.jpg', a: 'movil-primer-plano.webp', ancho: 760, desenfoque: 0, saturacion: 1, calidad: 0.8 },
];

mkdirSync(DESTINO, { recursive: true });

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
await pagina.setContent('<body style="margin:0">');

for (const receta of RECETAS) {
  const origen = `${ORIGEN}/${receta.de}`;
  const base64 = readFileSync(origen).toString('base64');

  const salida = await pagina.evaluate(
    async ({ base64, ancho, desenfoque, saturacion, calidad }) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${base64}`;
      await img.decode();

      const escala = ancho / img.naturalWidth;
      const alto = Math.round(img.naturalHeight * escala);

      /**
       * Sangrado para el desenfoque.
       *
       * Un `blur` en canvas mezcla con lo que hay fuera del dibujo, que es
       * transparente: sin esto, los cuatro bordes salen con un halo claro de
       * 20 px. Se dibuja la foto más grande que el lienzo y se recorta.
       */
      const sangre = desenfoque > 0 ? Math.ceil(desenfoque * 3) : 0;
      const lienzo = document.createElement('canvas');
      lienzo.width = ancho;
      lienzo.height = alto;
      const ctx = lienzo.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const filtros = [];
      if (desenfoque > 0) filtros.push(`blur(${desenfoque}px)`);
      if (saturacion !== 1) filtros.push(`saturate(${saturacion})`);
      if (filtros.length > 0) ctx.filter = filtros.join(' ');
      ctx.drawImage(
        img,
        -sangre,
        -sangre,
        ancho + sangre * 2,
        alto + sangre * 2,
      );

      return {
        datos: lienzo.toDataURL('image/webp', calidad).split(',')[1],
        ancho,
        alto,
      };
    },
    { ...receta, base64 },
  );

  const destino = `${DESTINO}/${receta.a}`;
  writeFileSync(destino, Buffer.from(salida.datos, 'base64'));
  const antes = statSync(origen).size;
  const despues = statSync(destino).size;
  console.log(
    `${receta.a.padEnd(34)} ${String(salida.ancho).padStart(4)}×${String(salida.alto).padEnd(4)}  ` +
      `${(despues / 1024).toFixed(1).padStart(6)} kB  (original ${(antes / 1024).toFixed(0)} kB)`,
  );
}

await navegador.close();
