'use client';

import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * Línea de lectura bajo una gráfica: al pasar el ratón o tocar un elemento con
 * `data-lectura`, enseña su texto. Un solo manejador delegado para toda la
 * gráfica (no uno por punto) y nada más que un `useState`: el SVG y los puntos
 * siguen llegando pintados del servidor, y sin JavaScript se ve `inicial`.
 */
export function Lectura({
  children,
  inicial,
  datos,
  className,
}: {
  children: ReactNode;
  /** Lo que se lee antes de tocar nada (p. ej. el último dato). */
  inicial?: string | null;
  /**
   * Las lecturas de cada punto, en orden. Van en una lista `sr-only`: la
   * gráfica es `role="img"` y la línea de lectura sólo responde al puntero.
   */
  datos?: readonly (string | null | undefined)[];
  className?: string;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  // Sin repetidos: dos series del mismo punto (dados y recibidos) comparten lectura.
  const todos = [...new Set((datos ?? []).filter((d): d is string => Boolean(d)))];
  // Cientos de asaltos serían una lista inservible: los más recientes (van al final).
  const leidos = todos.length > TOPE_DATOS ? todos.slice(-TOPE_DATOS) : todos;
  const leer = (e: SyntheticEvent) => {
    const el = (e.target as Element | null)?.closest?.('[data-lectura]');
    if (el && e.currentTarget.contains(el)) setTexto(el.getAttribute('data-lectura'));
  };
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      onPointerOver={leer}
      onClick={leer}
      // En táctil el puntero «sale» justo después de tocar: sólo el ratón borra la lectura.
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setTexto(null);
      }}
    >
      {children}
      {leidos.length > 0 ? (
        <ul className="sr-only">
          {leidos.length < todos.length ? <li>{`Los ${leidos.length} más recientes de ${todos.length}:`}</li> : null}
          {leidos.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
      {/*
        Sin `aria-live`: con una región por gráfica, pasar el ratón por la
        pantalla encadenaba avisos. El lector tiene los datos en la lista de
        arriba; con ella, esta línea sobra y se le oculta.
      */}
      <p aria-hidden={leidos.length > 0 || undefined} className="min-h-4 truncate text-xs leading-4 text-muted-foreground">
        {texto ?? inicial ?? '\u00a0'}
      </p>
    </div>
  );
}

const TOPE_DATOS = 12;
