'use client';

import Link from 'next/link';
import { forwardRef, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ahorrarDatos } from './red-cliente';

export type PropsEnlacePrecarga = Omit<ComponentProps<typeof Link>, 'prefetch'> & {
  /**
   * Precarga también al poner el dedo o pulsar. Solo donde pulsar casi
   * siempre es navegar (la barra de pestañas): en una lista, el inicio de un
   * gesto táctil no distingue pulsar de desplazar.
   */
  alPulsar?: boolean;
};

/**
 * `Link` que precarga por intención (`docs/diseno-sistema.md` § 5.4): al
 * detener el ratón, al enfocar con teclado y, con `alPulsar`, al pulsar.
 * Con ahorro de datos, 2G o sin red no se precarga nunca.
 */
export const EnlacePrecarga = forwardRef<HTMLAnchorElement, PropsEnlacePrecarga>(function EnlacePrecarga({
  alPulsar = false,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  ...props
}, ref) {
  const destino = typeof props.href === 'string' ? props.href : JSON.stringify(props.href);
  const [intencion, setIntencion] = useState<string | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelar = () => clearTimeout(espera.current);
  useEffect(() => () => clearTimeout(espera.current), [destino]);
  const avisar = () => { if (!ahorrarDatos()) setIntencion(destino); };
  return (
    <Link
      ref={ref}
      {...props}
      prefetch={intencion === destino}
      onPointerEnter={(e) => {
        cancelar();
        if (e.pointerType === 'mouse' && !ahorrarDatos()) espera.current = setTimeout(avisar, 120);
        onPointerEnter?.(e);
      }}
      onPointerDown={(e) => {
        // Entre pulsar y soltar pasan 80-150 ms: la petición sale antes que el clic.
        if (alPulsar && e.button === 0) {
          cancelar();
          avisar();
        }
        onPointerDown?.(e);
      }}
      onPointerLeave={(e) => {
        cancelar();
        // Al levantar el dedo llega `pointerleave` antes que el clic: no se retira la precarga que va en camino.
        if (e.pointerType === 'mouse') setIntencion(null);
        onPointerLeave?.(e);
      }}
      onFocus={(e) => {
        if (e.currentTarget.matches(':focus-visible')) avisar();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        cancelar();
        setIntencion(null);
        onBlur?.(e);
      }}
    />
  );
});
