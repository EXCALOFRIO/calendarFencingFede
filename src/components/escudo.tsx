'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * ===========================================================================
 * ESCUDOS DE LAS FEDERACIONES
 * ===========================================================================
 *
 * Petición literal del usuario:
 *
 *   «no veo nada de la federación ni nada, ni logo de la fede ni de la FIE
 *   para cambiar entre rankings, eso estaría guay a mí visual»
 *
 * Tiene dos usos, y el segundo sale en muchas más pantallas que el primero:
 *
 * 1. **Cambiar de ranking**: el escudo de la RFEE y el de la FIE como los dos
 *    lados de un conmutador (`conmutador-rankings.tsx`).
 * 2. **Procedencia**: decir de dónde sale un dato. Hoy eso es texto —«Skermo ·
 *    RFEE», «FIE»— y es justo la autoridad visual que el usuario echa en
 *    falta. Para eso está `<Procedencia>` al final de este fichero.
 *
 * ---------------------------------------------------------------------------
 * SE ENLAZAN, NO SE COPIAN. Y ESO NO ES PRUDENCIA: ES LA REGLA.
 * ---------------------------------------------------------------------------
 * Los dos son marcas de terceros y se sirven **desde su origen**, igual que
 * el cartel de la FIE y que las fotos de los tiradores. No hay ningún fichero
 * de estos escudos en este repositorio y no debe haberlo: los términos de la
 * FIE exigen permiso escrito para almacenar su contenido, y que la aplicación
 * sea interna cambia el riesgo, no la regla. Además su CDN es más rápido que
 * nuestro Worker y la imagen se actualiza si ellos la cambian.
 *
 * Tampoco se recolorean ni se recortan: un logotipo retocado es una obra
 * derivada, y encima queda mal. Se comprobó recortando el de la RFEE a un
 * cuadrado para quedarse solo con el escudo: a 44 px asomaban las letras
 * «RE» y «DE» del rótulo cortadas por la mitad. Descartado.
 *
 * ---------------------------------------------------------------------------
 * SOLO UNO DE LOS DOS LLEVA PLATO, Y ESO ESTÁ COMPROBADO
 * ---------------------------------------------------------------------------
 * La primera versión ponía los dos escudos sobre un plato **blanco puro**, y
 * al mirar la captura en móvil se veía el problema de golpe: los dos platos
 * eran los dos elementos más claros de toda la pantalla y se llevaban la
 * mirada antes que el `#25`, que es el dato. Dos pegatinas puestas encima de
 * la interfaz, no parte de ella.
 *
 * Así que se fue a buscar la variante para fondo oscuro, con peticiones y no
 * suponiendo (26/09/2026):
 *
 * - `fie.org/images/fie-logo-light.svg` → **200**, y su única tinta sólida es
 *   `fill="white"`. O sea que «light» ahí significa **tinta clara**, no «para
 *   fondo claro»: es exactamente la versión que hacía falta. `fie-logo.svg` es
 *   la azul marino (`#002D74`) y `fie-logo-dark.svg` no existe (404).
 * - De la RFEE no hay más que un archivo: `real-federacion-espanola-esgrima.png`,
 *   300×87, con **el fondo blanco metido dentro del propio archivo** y el
 *   rótulo en gris oscuro. Probadas varias rutas de una versión en blanco o
 *   del escudo suelto: todas 404.
 *
 * Conclusión: **la FIE va a pelo sobre el grafito** y solo la RFEE lleva
 * plato, porque su archivo lo trae puesto de fábrica. Y ese plato es ahora
 * ajustado al logotipo y a blanco al 90 %, no un rectángulo blanco más grande
 * que la marca. La asimetría no se ve nunca de golpe porque el escudo del lado
 * apagado va al 55 %.
 *
 * Lo que no se hace es recolorear el PNG de la RFEE con un filtro CSS para
 * quitarle el blanco: eso es alterar una marca ajena, y además su escudo es a
 * todo color y saldría un manchón.
 *
 * Los tamaños también están medidos (captura con los dos a 14, 18, 24, 32 y 44
 * px de alto): a 24 px se lee «REAL FEDERACIÓN ESPAÑOLA DE ESGRIMA» y a 32
 * cómodo; por debajo de 20 el rótulo es papilla. Por eso no hay tamaño más
 * pequeño que `nota`, y `nota` siempre va acompañado de texto nuestro.
 *
 * ---------------------------------------------------------------------------
 * SI EL ENLACE FALLA, TEXTO. Y HAY QUE COMPROBARLO DOS VECES.
 * ---------------------------------------------------------------------------
 * Dependemos de dos servidores ajenos, así que si uno no responde se cambia a
 * una pastilla con las siglas en vez de dejar el hueco de una imagen rota: un
 * conmutador honesto es mejor que un logotipo mal traído.
 *
 * `onError` **no basta**, y eso no es teoría: se cortaron los dos orígenes con
 * Playwright y la pantalla se quedó con dos rectángulos blancos vacíos
 * (`capturas/despues/escritorio-sin-escudos.png`, primera versión). El motivo
 * es que el `<img>` viene en el HTML del servidor: el navegador intenta
 * cargarlo y falla **antes** de que React hidrate y enganche el manejador, así
 * que el evento se pierde.
 *
 * La segunda comprobación es la que lo arregla: al montar se mira si la imagen
 * ya terminó (`complete`) con cero píxeles de ancho (`naturalWidth === 0`), que
 * es como se ve «esto falló mientras no mirabas».
 */

export type Federacion = 'RFEE' | 'FIE';

type Marca = {
  /** Enlace directo al origen. Nunca un fichero de este repositorio. */
  src: string;
  /** Nombre completo, para el `alt` y para el nombre accesible. */
  nombre: string;
  /** Siglas, para la pastilla de reserva si el enlace falla. */
  siglas: string;
  /** Proporción ancho/alto del original, para reservar el hueco sin salto. */
  proporcion: number;
  /**
   * `true` solo si el archivo trae el fondo blanco dentro y hay que darle un
   * plato claro. Los que publican versión de tinta clara van a pelo sobre el
   * grafito, que es lo que hay que hacer siempre que se pueda.
   */
  necesitaPlato: boolean;
  /** Su sitio, para poder ir a comprobar el dato. */
  web: string;
};

/**
 * De dónde sale cada uno, comprobado con peticiones el 26/09/2026:
 *
 * - RFEE: el logotipo de la cabecera de `esgrima.es`, con el `alt` que ellos
 *   mismos le ponen («Real Federación Española de Esgrima»). 300×87, 12,7 kB.
 *   Es el único que publican —probadas rutas de una versión en blanco y del
 *   escudo suelto, todas 404— y **trae el fondo blanco dentro del archivo**,
 *   así que es el único que lleva plato.
 * - FIE: `fie-logo-light.svg`, 200, 8 kB, y su única tinta sólida es
 *   `fill="white"`. «light» ahí significa **tinta clara**, no «para fondo
 *   claro»: es la versión para fondo oscuro, o sea la nuestra, y por eso va
 *   sin plato. Sus hermanas son `fie-logo.svg` (azul marino `#002D74`, para
 *   fondo claro) y `fie-logo-dark.svg`, que no existe (404).
 *
 * Los dos responden 200 con `Referer` de otro dominio, así que no hay
 * protección contra enlace directo que nos deje el hueco vacío.
 */
const MARCAS: Record<Federacion, Marca> = {
  RFEE: {
    src: 'https://esgrima.es/wp-content/uploads/2018/05/real-federacion-espanola-esgrima.png',
    nombre: 'Real Federación Española de Esgrima',
    siglas: 'RFEE',
    proporcion: 300 / 87,
    necesitaPlato: true,
    web: 'https://www.esgrima.es/',
  },
  FIE: {
    src: 'https://fie.org/images/fie-logo-light.svg',
    nombre: 'Federación Internacional de Esgrima',
    siglas: 'FIE',
    proporcion: 120 / 48,
    necesitaPlato: false,
    web: 'https://fie.org/',
  },
};

/**
 * Los tres tamaños, en píxeles de alto de la marca.
 *
 * No son una escala inventada: son los tres que sobreviven a la prueba de
 * mirarlos. 20 es el mínimo en el que se distingue el escudo de la RFEE, 24
 * es el del conmutador y 32 el de una cabecera.
 */
const ALTOS = { nota: 20, control: 24, grande: 32 } as const;

export type TamanoEscudo = keyof typeof ALTOS;

/**
 * El escudo de una federación, enlazado desde su origen.
 *
 * Lleva **siempre** nombre accesible. Cuando va solo, en el `alt`; cuando va
 * al lado de un rótulo que ya dice lo mismo, se pasa `decorativo` para que un
 * lector de pantalla no lo lea dos veces.
 */
export function Escudo({
  federacion,
  tamano = 'control',
  decorativo = false,
  className,
}: {
  federacion: Federacion;
  tamano?: TamanoEscudo;
  /** `true` cuando al lado ya hay texto que dice de quién es el escudo. */
  decorativo?: boolean;
  className?: string;
}) {
  const marca = MARCAS[federacion];
  const [roto, setRoto] = React.useState(false);
  const alto = ALTOS[tamano];
  const imagen = React.useRef<HTMLImageElement>(null);

  /**
   * Segunda red: si la carga ya había fallado antes de hidratar, `onError` no
   * llegó nunca. Una imagen terminada y con ancho natural cero es una imagen
   * rota.
   */
  React.useEffect(() => {
    const el = imagen.current;
    if (el && el.complete && el.naturalWidth === 0) setRoto(true);
  }, []);

  if (roto) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-md border border-border px-2',
          'font-medium text-muted-foreground',
          tamano === 'grande' ? 'text-sm' : 'text-xs',
          className,
        )}
        style={{ height: alto }}
        aria-label={decorativo ? undefined : marca.nombre}
        aria-hidden={decorativo || undefined}
        title={marca.nombre}
      >
        {marca.siglas}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        /*
          Plato solo para el de la RFEE, y ajustado.

          Blanco al 90 % y **sin borde ni relleno extra**: la primera versión
          usaba blanco puro con relleno en los dos escudos, y en la
          captura de móvil los dos platos eran lo más brillante de la pantalla
          y se llevaban la mirada antes que el `#25`. El PNG de la RFEE ya
          trae su propio margen blanco dentro, así que añadirle relleno solo
          hacía la caja más grande que la marca.
        */
        marca.necesitaPlato && 'rounded-md bg-white/90 p-px',
        className,
      )}
    >
      {/*
        `<img>` a pelo y no `next/image`: optimizarla significaría descargarla
        y servirla desde nuestro dominio, que es rehospedar. Es la misma regla
        que rige las fotos de los tiradores (ver `fotoFieAncho`).

        El hueco se reserva con `width`/`height` para que no haya salto de
        maquetado mientras carga.
      */}
      <img
        ref={imagen}
        src={marca.src}
        alt={decorativo ? '' : marca.nombre}
        aria-hidden={decorativo || undefined}
        width={Math.round(alto * marca.proporcion)}
        height={alto}
        style={{ height: alto, width: 'auto' }}
        /*
          Carga inmediata, no diferida. El escudo del conmutador está en la
          primera pantalla, y `loading="lazy"` en algo que ya se ve solo añade
          un salto: es el mismo fallo que dejaba la ficha de torneo con 200 px
          de negro mientras cargaba el cartel.
        */
        decoding="async"
        onError={() => setRoto(true)}
      />
    </span>
  );
}

/**
 * De dónde sale un dato: el escudo y una línea de texto.
 *
 * Es la forma corta de cumplir la regla del proyecto de que todo dato diga su
 * procedencia, sin gastar un párrafo. El escudo da la autoridad y el texto
 * dice qué es exactamente, porque a 20 px el rótulo del logotipo no se lee y
 * un escudo suelto no explica nada.
 *
 *   <Procedencia federacion="RFEE">
 *     Clasificación oficial, leída el 25 sept 2026
 *   </Procedencia>
 */
export function Procedencia({
  federacion,
  children,
  className,
}: {
  federacion: Federacion;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <Escudo federacion={federacion} tamano="nota" decorativo />
      <span className="medida">{children}</span>
    </p>
  );
}

/** El nombre completo de una federación, para textos y etiquetas. */
export function nombreFederacion(federacion: Federacion): string {
  return MARCAS[federacion].nombre;
}

/** Su sitio web, para cuando hay que enlazar a la fuente. */
export function webFederacion(federacion: Federacion): string {
  return MARCAS[federacion].web;
}
