import { Users } from 'lucide-react';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { cn } from '@/lib/utils';
import { Avatar } from './avatar';
import { EnlacePrecarga } from './enlace-precarga';
import { MarcaPropia, Puesto } from './pastilla';

/**
 * La fila de una persona (o de un equipo), igual en toda la aplicación:
 *
 *   [puesto] [avatar] [bandera + nombre / meta] [insignias]
 *
 * Las columnas tienen ancho fijo, así que en una lista los nombres caen en la
 * misma vertical aunque unas filas tengan foto y otras sean equipos. El
 * nombre se recorta con «…» y el completo queda en `title`. Con `href`, toda
 * la fila es el objetivo táctil (el enlace del nombre se estira encima); las
 * insignias quedan por encima por si alguna es pulsable.
 *
 * Con `apilar`, en móvil las insignias van una encima de otra (FIE #126 sobre
 * RFEE #2): a 360 px, «Tú» y dos pastillas en fila dejaban el nombre en
 * tres letras.
 */

export type PersonaFila = {
  id?: string | null;
  nombre: string;
  /** ISO de dos letras o código FIE de tres. */
  pais?: string | null;
};

export type PropsFilaPersona = {
  persona: PersonaFila;
  href?: string;
  /** Por defecto se reserva el hueco del avatar. */
  avatar?: boolean;
  /** Fila de equipo: el hueco del avatar lleva un icono de equipo. */
  equipo?: boolean;
  puesto?: number | null;
  /** Pastillas de la derecha: `PastillaRanking`, `Pastilla`… */
  insignias?: React.ReactNode;
  /** En móvil, las insignias en columna. Para varias pastillas, no para un botón. */
  apilar?: boolean;
  /** Segunda línea en gris: club, categoría, edad. */
  meta?: React.ReactNode;
  /** La fila de la propia cuenta: lleva «Tú» y se resalta. */
  propia?: boolean;
  densidad?: 'normal' | 'compacta';
  /** Persona sin resultados propios: la foto en gris. */
  apagado?: boolean;
  /** Pasa a `Link`: `TIPO_TRANSICION` de `sistema/navegacion`. */
  transitionTypes?: string[];
  /** Atributos del enlace del nombre: `id` y `data-*`. */
  enlace?: { id?: string } & { [atributo: `data-${string}`]: string | undefined };
  className?: string;
};

/** Columnas fijas según los huecos que lleve la fila. */
const COLUMNAS = {
  pa: 'grid-cols-[2rem_auto_minmax(0,1fr)_auto]',
  p: 'grid-cols-[2rem_minmax(0,1fr)_auto]',
  a: 'grid-cols-[auto_minmax(0,1fr)_auto]',
  '': 'grid-cols-[minmax(0,1fr)_auto]',
} as const;

export function FilaPersona({
  persona,
  href,
  avatar = true,
  equipo = false,
  puesto,
  insignias,
  meta,
  apilar = false,
  propia = false,
  densidad = 'normal',
  apagado = false,
  transitionTypes,
  enlace,
  className,
}: PropsFilaPersona) {
  const compacta = densidad === 'compacta';
  const tamanoAvatar = compacta ? 28 : 40;
  const conPuesto = puesto !== undefined;

  const nombre = href ? (
    <EnlacePrecarga
      {...enlace}
      href={href}
      transitionTypes={transitionTypes}
      title={persona.nombre}
      className={cn(
        'min-w-0 truncate font-semibold text-foreground',
        // El enlace se estira a toda la fila: un toque en cualquier sitio abre la ficha.
        "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none",
        'rounded-md focus-visible:after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring',
      )}
    >
      {persona.nombre}
    </EnlacePrecarga>
  ) : (
    <span title={persona.nombre} className="min-w-0 truncate font-semibold text-foreground">
      {persona.nombre}
    </span>
  );

  return (
    <div
      data-slot="sistema-fila-persona"
      data-propia={propia || undefined}
      className={cn(
        'relative grid min-h-11 min-w-0 items-center gap-x-3',
        COLUMNAS[`${conPuesto ? 'p' : ''}${avatar ? 'a' : ''}` as keyof typeof COLUMNAS],
        compacta ? 'py-2' : 'py-3',
        propia && '-mx-2 rounded-xl bg-marcado px-2',
        href && 'transition-colors hover:bg-accent/40',
        className,
      )}
    >
      {conPuesto ? <Puesto puesto={puesto} className="justify-self-center" /> : null}

      {avatar ? (
        equipo ? (
          <span
            aria-hidden
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground',
              compacta ? 'size-7 [&_svg]:size-4' : 'size-10 [&_svg]:size-5',
            )}
          >
            <Users />
          </span>
        ) : (
          <Avatar personaId={persona.id ?? undefined} nombre={persona.nombre} tamano={tamanoAvatar} apagado={apagado} />
        )
      ) : null}

      <div className="flex min-w-0 flex-col">
        <div className={cn('flex min-w-0 items-center gap-2', compacta ? 'text-sm' : 'text-base')}>
          {persona.pais ? (
            <BanderaPais pais={persona.pais} soloBandera className="[&_img]:h-3 [&_img]:w-[18px]" />
          ) : null}
          {nombre}
        </div>
        {meta ? <div className="min-w-0 truncate text-sm text-muted-foreground">{meta}</div> : null}
      </div>

      <div className="relative z-10 flex shrink-0 flex-nowrap items-center justify-end gap-1">
        {propia ? <MarcaPropia /> : null}
        {apilar && insignias ? (
          <div data-apiladas className="flex flex-col items-end gap-1 sm:flex-row sm:items-center">
            {insignias}
          </div>
        ) : (
          insignias
        )}
      </div>
    </div>
  );
}
