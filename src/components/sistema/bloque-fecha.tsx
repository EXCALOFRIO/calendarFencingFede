import * as React from 'react';
import { diaMadrid, rangoFechas, type EntradaFecha } from '@/lib/fechas';
import { cn } from '@/lib/utils';

/**
 * La fecha de un torneo en bloque: días grandes y mes en versalitas debajo.
 *
 *   15–18   30–2
 *    OCT   SEPT–OCT
 *
 * Ancho fijo (48 px en filas, 60 px en tarjetas) para que los títulos de una
 * lista caigan en la misma vertical. El lector oye el rango entero con año.
 */
export function BloqueFecha({
  desde,
  hasta,
  tamano = 'fila',
  className,
}: {
  desde: EntradaFecha;
  hasta?: EntradaFecha | null;
  tamano?: 'fila' | 'tarjeta';
  className?: string;
}) {
  const { dias, mes, etiqueta } = rangoFechas(desde, hasta, 'bloque');
  if (!dias) return null;
  const tarjeta = tamano === 'tarjeta';
  const largo = dias.length > 3;
  return (
    <time
      dateTime={diaMadrid(desde)}
      data-slot="sistema-bloque-fecha"
      title={etiqueta}
      className={cn(
        'flex shrink-0 flex-col items-center justify-center text-center leading-tight tabular-nums',
        tarjeta ? 'w-15' : 'w-12',
        className,
      )}
    >
      <span aria-hidden className={cn('font-semibold text-foreground', tarjeta ? (largo ? 'text-lg' : 'text-2xl') : largo ? 'text-sm' : 'text-lg')}>
        {dias}
      </span>
      <span aria-hidden className="max-w-full text-xs font-medium break-words text-muted-foreground">
        {mes}
      </span>
      <span className="sr-only">{etiqueta}</span>
    </time>
  );
}
