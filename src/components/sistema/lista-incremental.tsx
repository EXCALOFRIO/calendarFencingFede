'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { VerMas } from './cabecera-seccion';

/**
 * El pie de una lista que se pinta por lotes, con los datos ya en cliente.
 *
 * Se monta justo detrás de la lista: un `IntersectionObserver` sobre el
 * hueco pide el siguiente lote al asomar —con `disconnect` en la limpieza,
 * el patrón de `feed-incremental`— y el `VerMas` (o el botón que se pase)
 * queda de respaldo para pedirlo a mano y para navegadores sin observador.
 * Con `quedan` en 0 no se pinta nada ni se observa.
 *
 * El contenedor no es enfocable: no roba foco y no hace falta `aria-live`,
 * el lote nuevo aparece donde ya estaba el pie. Y los lotes se añaden tal
 * cual, sin animación de entrada: la regla del sistema prohíbe escalonados
 * en listas.
 */
export function PieIncremental({
  quedan,
  alAsomar,
  cuenta,
  detalle,
  children,
  className,
}: {
  /** Filas que faltan por pintar; con 0 no se pinta nada ni se observa. */
  quedan: number;
  /** Sube el tope del padre un lote. Se llama al asomar y al pulsar el respaldo. */
  alAsomar: () => void;
  /** La cifra del `VerMas` de respaldo. */
  cuenta?: number | null;
  /** El matiz accesible del `VerMas` («de la clasificación»). */
  detalle?: string;
  /** Pie propio en lugar del `VerMas` (un botón con otra forma o texto). */
  children?: React.ReactNode;
  className?: string;
}) {
  const centinela = React.useRef<HTMLDivElement>(null);
  // La última versión de la orden, sin rehacer el observador en cada render.
  const alAsomarViva = React.useRef(alAsomar);
  React.useEffect(() => {
    alAsomarViva.current = alAsomar;
  });

  React.useEffect(() => {
    const nodo = centinela.current;
    if (!nodo || quedan <= 0 || typeof IntersectionObserver === 'undefined') return;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) alAsomarViva.current();
      },
      { rootMargin: '600px 0px' },
    );
    observador.observe(nodo);
    return () => observador.disconnect();
  }, [quedan]);

  if (quedan <= 0) return null;

  return (
    <div ref={centinela} className={cn('flex justify-center', className)}>
      {children ?? <VerMas onClick={alAsomar} cuenta={cuenta} detalle={detalle} />}
    </div>
  );
}
