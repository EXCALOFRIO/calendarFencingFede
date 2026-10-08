import { ScanText } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { AREA_TACTIL, FOCO, SIN_MINIMO } from './tactil';

/**
 * Pares clave–valor en un `<dl>` de verdad: cada par es un `<div>` con el
 * `<dt>` antes del `<dd>`, que es el orden en que lo lee un lector de
 * pantalla.
 *
 * - `columna`: rótulo pequeño encima del valor, un par debajo de otro.
 * - `linea`: rótulo a la izquierda y valor a la derecha, con filete.
 * - `rejilla`: como `columna`, en dos columnas.
 *
 * La procedencia de un dato (`fuente`) es un botón aparte al final del par,
 * nunca un icono pegado al valor («80 € ⧉» se leía como parte del precio).
 *
 * La disposición la lee cada `ParDato` del atributo `data-disposicion` del
 * `<dl>` con variantes `group-data-*`, y no de un contexto de React: así las
 * dos piezas sirven en componentes de servidor.
 */

export type Disposicion = 'columna' | 'linea' | 'rejilla';

export function ListaDatos({
  disposicion = 'columna',
  className,
  children,
  ...resto
}: React.ComponentProps<'dl'> & { disposicion?: Disposicion }) {
  return (
    <dl
      data-slot="sistema-lista-datos"
      data-disposicion={disposicion}
      className={cn(
        'group/datos min-w-0',
        disposicion === 'columna' && 'flex flex-col gap-3',
        disposicion === 'rejilla' && 'grid grid-cols-2 gap-x-4 gap-y-3',
        disposicion === 'linea' && 'flex flex-col divide-y divide-border',
        className,
      )}
      {...resto}
    >
      {children}
    </dl>
  );
}

export type FuenteDato = {
  /** Nombre accesible: «Ver en la convocatoria». */
  etiqueta: string;
  href?: string;
  onClick?: () => void;
  /** Abre en otra pestaña (PDF de la convocatoria). */
  externa?: boolean;
  icono?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
};

function BotonFuente({ fuente }: { fuente: FuenteDato }) {
  const Icono = fuente.icono ?? ScanText;
  const clases = cn(
    SIN_MINIMO,
    FOCO,
    AREA_TACTIL,
    'ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground [&_svg]:size-4',
    'group-data-[disposicion=linea]/datos:ml-0',
  );
  if (fuente.href) {
    return (
      <a
        href={fuente.href}
        aria-label={fuente.etiqueta}
        title={fuente.etiqueta}
        data-slot="sistema-fuente-dato"
        className={clases}
        {...(fuente.externa ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        <Icono aria-hidden />
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label={fuente.etiqueta}
      title={fuente.etiqueta}
      data-slot="sistema-fuente-dato"
      onClick={fuente.onClick}
      className={clases}
    >
      <Icono aria-hidden />
    </button>
  );
}

export function ParDato({
  etiqueta,
  icono: Icono,
  fuente,
  className,
  children,
}: {
  etiqueta: React.ReactNode;
  icono?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** Procedencia del dato, como botón aparte. Con `onClick` el componente que lo usa debe ser cliente. */
  fuente?: FuenteDato | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="sistema-par-dato"
      className={cn(
        'flex min-w-0 flex-col gap-1',
        'group-data-[disposicion=linea]/datos:min-h-11 group-data-[disposicion=linea]/datos:flex-row group-data-[disposicion=linea]/datos:items-center group-data-[disposicion=linea]/datos:justify-between group-data-[disposicion=linea]/datos:gap-4 group-data-[disposicion=linea]/datos:py-2',
        className,
      )}
    >
      {/*
        En `linea` rótulo y valor encogen y saltan de línea; el rótulo nunca
        por debajo de su palabra más larga, para no partir «Club» en «Clu-b».
      */}
      <dt className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground group-data-[disposicion=linea]/datos:min-w-auto">
        {Icono ? <Icono aria-hidden className="size-4 shrink-0" /> : null}
        <span className="min-w-0 break-words">{etiqueta}</span>
      </dt>
      <dd
        className={cn(
          'flex min-w-0 items-center gap-2 text-base text-foreground',
          'group-data-[disposicion=linea]/datos:justify-end group-data-[disposicion=linea]/datos:pl-0 group-data-[disposicion=linea]/datos:text-right',
          Icono && 'pl-6',
        )}
      >
        <span className="min-w-0 break-words">{children}</span>
        {fuente ? <BotonFuente fuente={fuente} /> : null}
      </dd>
    </div>
  );
}
