'use client';

import { ExternalLink } from 'lucide-react';
import type * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * ===========================================================================
 * CABECERA DE FICHA DE TIRADOR
 * ===========================================================================
 *
 * Copia la jerarquía de `fie.org/athletes/39653` (referencia 3.1), mirada en
 * `capturas/ref/fie-escritorio-cabecera.png`. Cuatro decisiones, y cada una
 * tiene un motivo:
 *
 * 1. **El apellido en negrita gruesa y el nombre en fino, en la misma línea.**
 *    `HSIEH Kaylin Sin Yan`. Se lee el apellido de golpe —que es como se
 *    nombra a un tirador en una competición, en el marcador y en el acta— y el
 *    nombre completo si te fijas. Aquí sale gratis porque `athlete` ya guarda
 *    `firstName` y `lastName` por separado.
 * 2. **El puesto como insignia, no como un dato más de una lista.** Grande, en
 *    una pastilla, al lado de la cara. Es lo primero que quiere saber
 *    cualquiera que abre la ficha de un tirador.
 * 3. **La bandera en pastilla** junto al país.
 * 4. **Pares etiqueta apagada / valor en blanco y negrita.** Nunca al revés.
 *    Es lo que separa una ficha de un volcado de base de datos.
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO SE COPIA DE LA REFERENCIA
 * ---------------------------------------------------------------------------
 * - **El móvil.** En un iPhone la ficha de la FIE pone la foto a 645 px de
 *   alto y empuja el nombre y la insignia fuera de la pantalla; hay que hacer
 *   scroll para ver de quién es la cara (comprobado en
 *   `capturas/ref/fie-iphone-cabecera.png`). Aquí el móvil manda, así que la
 *   foto se queda en 88 px y todo lo importante cabe sin desplazarse.
 * - **«Height: 0».** La FIE imprime un cero cuando no tiene la altura. Esa es
 *   exactamente la trampa que la regla del proyecto prohíbe: un dato que no
 *   está se dice, o no se pinta el campo. Aquí un `valor` a `null` escribe «no
 *   publicado» en apagado, y un dato que no tenemos no se pasa.
 *
 * ---------------------------------------------------------------------------
 * LA FOTO SE ENLAZA, NO SE COPIA
 * ---------------------------------------------------------------------------
 * `url` tiene que ser una de `fotoUrlRetrato` / `fotoUrlMini` de
 * `getFichasFie`, que apuntan al redimensionador de la propia FIE. Se pinta
 * con el `<img>` de Radix, **sin pasar por `next/image`**: optimizarla sería
 * servir una copia nuestra, y eso es rehospedar. Y se enlaza SIEMPRE a su
 * ficha en fie.org, que es la condición con la que se puede usar el dato.
 *
 * Si la imagen falla, `Avatar` de Radix cae solo a las iniciales: no queda el
 * boquete de 200 px que ya nos pasó una vez con el cartel de la FIE.
 */

export type DatoFicha = {
  etiqueta: string;
  /** Ya formateado. `null` escribe «no publicado» en apagado. */
  valor: React.ReactNode | null;
  /** Segunda línea pequeña bajo el valor: «de 50 clasificados». */
  pie?: React.ReactNode;
  /** Resalta este par cuando es el que importa de la pantalla. */
  destacado?: boolean;
};

export type FotoTirador = {
  /** Enlace a `static.fie.org` vía su redimensionador. Nunca una copia local. */
  url: string | null;
  /** Su ficha en fie.org. Obligatoria si se enseña la foto. */
  fichaUrl: string | null;
  /** Como lo publica la FIE: «LLAVADOR Carlos». Para el pie de la foto. */
  nombrePublicado?: string | null;
};

export type Insignia = {
  /** `null` cuando no está clasificado: se pinta una raya, no un cero. */
  puesto: number | null;
  /** Qué ranking es: «en España», «del mundo». Va debajo, diminuto. */
  rotulo: string;
  /** `acento` para el puesto de quien mira; `neutro` para los demás. */
  tono?: 'acento' | 'neutro';
};

export function CabeceraTirador({
  apellidos,
  nombre,
  foto,
  insignia,
  pais,
  datos,
  selector,
  acciones,
  pie,
  className,
}: {
  apellidos: string;
  nombre: string;
  foto?: FotoTirador | null;
  insignia?: Insignia | null;
  /**
   * El país tal y como lo publica la fuente: «ESP». La pastilla la pinta
   * `BanderaPais`, que es de otro agente (sección 9 de `REFERENCIAS.md`:
   * banderas hay una y se importa). Sin país no se pinta nada, porque ese
   * componente ya devuelve `null`: no se inventa una nacionalidad.
   *
   * Y no es emoji a propósito. El emoji derivado del ISO **no se pinta en
   * Windows** —sale como las dos letras— y aquí se desarrolla en Windows, así
   * que la pastilla lleva el código de tres letras de la FIE.
   */
  pais?: string | null;
  datos: DatoFicha[];
  /** El «View by: Senior» de la referencia. Va arriba a la derecha. */
  selector?: React.ReactNode;
  acciones?: React.ReactNode;
  /** Procedencia del dato, al pie de la cabecera. */
  pie?: React.ReactNode;
  className?: string;
}) {
  const iniciales =
    `${nombre.trim().charAt(0)}${apellidos.trim().charAt(0)}`.toUpperCase();
  const nombreCompleto = `${nombre} ${apellidos}`.trim();

  return (
    <section className={cn('flex min-w-0 flex-col gap-4', className)}>
      {/*
        Selector y acciones en su propia fila, arriba y a la derecha.

        Estaban dentro de la fila de la foto y dejaban un rectángulo vacío de
        unos 70 px entre el nombre y los datos, porque la foto mide 160 px de
        alto y el bloque del nombre solo 90 (se vio en la captura de
        escritorio). Subiéndolos, los pares etiqueta/valor se colocan **a la
        derecha de la foto**, que es donde están en la referencia, y el hueco
        desaparece.
      */}
      {selector || acciones ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selector}
          {acciones}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-4">
        <Foto foto={foto} iniciales={iniciales} nombreCompleto={nombreCompleto} />

        <div className="flex min-w-40 flex-1 flex-col gap-2 lg:max-w-xs lg:flex-none">
          {insignia ? <InsigniaPuesto insignia={insignia} /> : null}

          {/*
            Apellido grueso + nombre fino en la misma línea, como `HSIEH Kaylin
            Sin Yan` en la referencia.

            Los pesos son **700 y 500**, no 600 y 300, y eso no es capricho:
            `layout.tsx` carga Barlow Condensed solo en 500, 600 y 700. Con
            `font-light` el navegador caía al 500 y el apellido y el nombre
            salían con el mismo grosor —se vio en la captura—, o sea que la
            jerarquía no existía. Y el nombre baja además de luminosidad, para
            que la diferencia no dependa solo del grosor.
          */}
          <h2 className="min-w-0 text-2xl leading-tight sm:text-3xl">
            <span className="font-bold">{apellidos}</span>{' '}
            <span className="font-medium text-foreground/70">{nombre}</span>
          </h2>

          {/*
            `self-start` porque la pastilla es `inline-grid` y aquí vive en una
            columna flexible: sin esto el `align-items: stretch` del padre la
            estiraba de lado a lado y «ESP» salía centrado en una barra de
            ancho completo. Visto en la captura de móvil.
          */}
          <BanderaPais pais={pais} tamaño="ficha" className="self-start" />
        </div>

        {datos.length > 0 ? (
          /*
            Rejilla de pares, no una cadena `A · B · C`: el contrato de
            interfaz lo prohíbe expresamente y con razón, porque encadenados no
            se sabe qué es cada cosa. Dos columnas en móvil para que la
            etiqueta y el valor quepan sin partirse; en escritorio se coloca a
            la derecha de la foto, como en la referencia.
          */
          <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:w-auto lg:flex-1 lg:grid-cols-3">
            {datos.map((dato) => (
              <Par key={dato.etiqueta} dato={dato} />
            ))}
          </dl>
        ) : null}
      </div>

      {pie}
    </section>
  );
}

function Foto({
  foto,
  iniciales,
  nombreCompleto,
}: {
  foto?: FotoTirador | null;
  iniciales: string;
  nombreCompleto: string;
}) {
  /*
    Rectángulo vertical y radio estructural, no un círculo: es una foto de
    ficha federativa, encuadrada de pecho para arriba, y recortarla en redondo
    le come los hombros.

    80 px en móvil y 128 en escritorio. El 80 está medido: con la foto a 88 px
    y la columna del nombre a `min-w-48`, en un iPhone la suma se pasaba del
    ancho y la foto se quedaba sola en una fila, con medio móvil vacío al lado
    (se vio en `capturas/iphone-ranking.png`). Con 80 y `min-w-40` caben las
    dos, que es el orden de la referencia.
  */
  const marco = 'h-auto w-20 shrink-0 rounded-lg sm:w-32';

  if (!foto?.url) {
    return (
      <Avatar className={cn(marco, 'aspect-[4/5]')} aria-hidden>
        <AvatarFallback className="cifra rounded-lg bg-muted text-3xl text-muted-foreground">
          {iniciales}
        </AvatarFallback>
      </Avatar>
    );
  }

  const imagen = (
    <Avatar className={cn(marco, 'aspect-[4/5]')}>
      <AvatarImage
        src={foto.url}
        alt={`Foto de ${foto.nombrePublicado ?? nombreCompleto} publicada por la FIE`}
        className="aspect-[4/5] object-cover object-top"
      />
      <AvatarFallback className="cifra rounded-lg bg-muted text-3xl text-muted-foreground">
        {iniciales}
      </AvatarFallback>
    </Avatar>
  );

  if (!foto.fichaUrl) return imagen;

  return (
    <a
      href={foto.fichaUrl}
      target="_blank"
      rel="noreferrer"
      className="group/foto relative shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`Ver la ficha de ${nombreCompleto} en fie.org`}
    >
      {imagen}
      <ExternalLink
        aria-hidden
        className="absolute end-1 bottom-1 size-3.5 text-white/70 transition-colors group-hover/foto:text-white"
      />
    </a>
  );
}

/**
 * El puesto como insignia.
 *
 * Pastilla con borde, no rellena del color de acento: la sección 9.1 de
 * `REFERENCIAS.md` reserva el relleno de acento para la acción principal de la
 * pantalla. Lo que va en carmesí es la cifra, que es texto y sí llega a AA
 * (`--primary-text`).
 */
function InsigniaPuesto({ insignia }: { insignia: Insignia }) {
  const acento = insignia.tono !== 'neutro';

  return (
    <p
      className={cn(
        'flex w-fit items-center gap-2 rounded-full border py-1.5 pe-4 ps-3',
        acento ? 'border-primary/50 bg-primary/10' : 'border-border bg-secondary/60',
      )}
    >
      <span className="flex items-baseline gap-0.5">
        <span className="text-sm text-muted-foreground" aria-hidden>
          #
        </span>
        <span
          className={cn(
            'cifra text-3xl sm:text-4xl',
            acento ? 'text-primary-text' : 'text-foreground',
          )}
        >
          {insignia.puesto ?? '—'}
        </span>
      </span>
      <span className="max-w-24 text-xs leading-tight text-muted-foreground">
        {insignia.puesto === null ? 'sin clasificar' : insignia.rotulo}
      </span>
    </p>
  );
}

/** Etiqueta apagada arriba, valor en blanco y negrita debajo. Nunca al revés. */
function Par({ dato }: { dato: DatoFicha }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{dato.etiqueta}</dt>
      <dd
        className={cn(
          'min-w-0 font-semibold',
          dato.destacado ? 'text-base' : 'text-sm',
          dato.valor === null && 'font-normal text-muted-foreground',
        )}
      >
        {dato.valor ?? 'No publicado'}
      </dd>
      {dato.pie ? (
        <dd className="text-xs font-normal text-muted-foreground">{dato.pie}</dd>
      ) : null}
    </div>
  );
}
