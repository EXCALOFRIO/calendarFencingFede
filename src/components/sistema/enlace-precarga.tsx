'use client';

import Link from 'next/link';
import { forwardRef, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ahorrarDatos } from './red-cliente';

/**
 * `Link` que precarga por intención (`docs/diseno-sistema.md` § 5.4): al
 * detener el ratón o enfocar con teclado. El inicio de un gesto táctil no
 * distingue pulsar de desplazar: el toque navega, pero nunca especula.
 * Con ahorro de datos, 2G o sin red tampoco se precarga.
 */
export const EnlacePrecarga = forwardRef<HTMLAnchorElement, Omit<ComponentProps<typeof Link>, 'prefetch'>>(function EnlacePrecarga({
  onPointerEnter,
  onPointerLeave,
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
      onPointerLeave={(e) => {
        cancelar();
        setIntencion(null);
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
