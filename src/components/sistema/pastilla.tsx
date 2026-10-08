import * as React from 'react';
import { CLASES_MEDALLA, medallaDe, type Medalla } from '@/lib/sport/explorar/presentacion';
import { cn } from '@/lib/utils';

/**
 * Pastilla: una etiqueta corta, no pulsable. Dos alturas en toda la
 * aplicación, `sm` 20 px (dentro de filas) y `md` 24 px (cabeceras, fichas).
 * El texto nunca salta de línea; si no cabe, quien la usa decide qué quitar.
 */

export type TonoPastilla =
  | 'neutro'
  | 'ok'
  | 'aviso'
  | 'peligro'
  | 'info'
  | 'marca'
  | 'oro'
  | 'plata'
  | 'bronce';

export type TamanoPastilla = 'sm' | 'md';

const TONOS: Record<TonoPastilla, string> = {
  neutro: 'border-transparent bg-secondary text-foreground',
  ok: 'border-transparent bg-secondary text-ok',
  aviso: 'border-transparent bg-warn-tinte text-warn',
  peligro: 'border-transparent bg-secondary text-danger',
  info: 'border-transparent bg-org-fie-tinte text-org-fie',
  marca: 'border-transparent bg-primary text-primary-foreground',
  oro: CLASES_MEDALLA.oro,
  plata: CLASES_MEDALLA.plata,
  bronce: CLASES_MEDALLA.bronce,
};

const TAMANOS: Record<TamanoPastilla, string> = {
  sm: 'h-5 gap-1 px-2 text-xs [&_svg]:size-3',
  md: 'h-6 gap-1 px-2 text-sm [&_svg]:size-4',
};

export function clasesPastilla(tono: TonoPastilla = 'neutro', tamano: TamanoPastilla = 'sm'): string {
  return cn(
    'inline-flex max-w-full shrink-0 items-center rounded-full border font-medium leading-none whitespace-nowrap',
    '[&_svg]:shrink-0',
    TAMANOS[tamano],
    TONOS[tono],
  );
}

export type PropsPastilla = React.ComponentProps<'span'> & {
  tono?: TonoPastilla;
  tamano?: TamanoPastilla;
  icono?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
};

export function Pastilla({ tono = 'neutro', tamano = 'sm', icono: Icono, className, children, ...resto }: PropsPastilla) {
  return (
    <span data-slot="sistema-pastilla" data-tono={tono} className={cn(clasesPastilla(tono, tamano), className)} {...resto}>
      {Icono ? <Icono aria-hidden /> : null}
      {children}
    </span>
  );
}

/** «FIE #126»: fuente del ranking y puesto, en cifras tabulares sobre fondo neutro. */
export function PastillaRanking({
  fuente,
  puesto,
  tamano = 'sm',
  className,
}: {
  /** «FIE», «RFEE», «EFC». */
  fuente: string;
  puesto: number;
  tamano?: TamanoPastilla;
  className?: string;
}) {
  return (
    <span
      data-slot="sistema-pastilla-ranking"
      className={cn(clasesPastilla('neutro', tamano), 'border-border tabular-nums', className)}
    >
      <span aria-hidden>
        {fuente} #{puesto}
      </span>
      <span className="sr-only">
        Puesto {puesto} del ranking {fuente}
      </span>
    </span>
  );
}

const METAL: Record<Medalla, string> = { oro: 'Oro', plata: 'Plata', bronce: 'Bronce' };

/**
 * El puesto en una clasificación. Del 1 al 3, disco con el tono de la
 * medalla y el metal dicho al lector (el color no puede ser la única señal);
 * el resto, la cifra sola en gris.
 */
export function Puesto({
  puesto,
  tamano = 'sm',
  className,
}: {
  puesto: number | null | undefined;
  /** `sm` 24 px para filas, `md` 32 px para cabeceras. */
  tamano?: TamanoPastilla;
  className?: string;
}) {
  const medalla = medallaDe(puesto);
  const caja = tamano === 'sm' ? 'size-6 text-xs' : 'size-8 text-sm';
  if (medalla) {
    return (
      <span
        data-slot="sistema-puesto"
        data-medalla={medalla}
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full border font-semibold leading-none tabular-nums', caja, CLASES_MEDALLA[medalla], className)}
      >
        <span className="sr-only">{METAL[medalla]}, puesto </span>
        {puesto}
      </span>
    );
  }
  return (
    <span
      data-slot="sistema-puesto"
      className={cn('inline-flex shrink-0 items-center justify-center font-medium leading-none text-muted-foreground tabular-nums', caja, className)}
    >
      {puesto == null ? (
        <>
          <span className="sr-only">Sin puesto</span>
          <span aria-hidden>—</span>
        </>
      ) : (
        <>
          <span className="sr-only">Puesto </span>
          {puesto}
        </>
      )}
    </span>
  );
}

/** «Tú»: marca la fila de la propia cuenta. Siempre con mayúscula. */
export function MarcaPropia({ tamano = 'sm', className }: { tamano?: TamanoPastilla; className?: string }) {
  return (
    <Pastilla tono="marca" tamano={tamano} className={className} data-slot="sistema-marca-propia">
      Tú
    </Pastilla>
  );
}
