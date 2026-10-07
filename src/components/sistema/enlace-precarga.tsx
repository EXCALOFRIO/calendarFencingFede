'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

/**
 * `Link` que precarga por intención (`docs/diseno-sistema.md` § 5.4): al
 * pasar el puntero, al poner el dedo o al enfocar, y no al entrar en la
 * ventana. Las pantallas son dinámicas: precargar cada enlace visible serían
 * varios renderizados de servidor por visita.
 */
export function EnlacePrecarga({
  onPointerEnter,
  onPointerDown,
  onFocus,
  ...props
}: Omit<ComponentProps<typeof Link>, 'prefetch'>) {
  const [intencion, setIntencion] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intencion}
      onPointerEnter={(e) => {
        setIntencion(true);
        onPointerEnter?.(e);
      }}
      onPointerDown={(e) => {
        setIntencion(true);
        onPointerDown?.(e);
      }}
      onFocus={(e) => {
        setIntencion(true);
        onFocus?.(e);
      }}
    />
  );
}
