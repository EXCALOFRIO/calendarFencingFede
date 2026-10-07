'use client';

import Link from 'next/link';
import * as React from 'react';

type Props = Omit<React.ComponentProps<typeof Link>, 'prefetch'>;

/**
 * Enlace que precarga la ruta entera (`prefetch={true}`) en cuanto hay
 * intención: el puntero entra, se toca o se enfoca. Hasta entonces no precarga
 * nada, así que una lista larga no dispara cientos de peticiones al pintarse.
 *
 * Es lo que permite navegar sin `loading.tsx` ni esqueletos: sin límite de
 * carga, Next mantiene la pantalla anterior hasta que la nueva está entera, y
 * con la precarga por intención casi siempre ya lo está al pulsar.
 */
export const EnlaceIntencion = React.forwardRef<HTMLAnchorElement, Props>(function EnlaceIntencion(
  { onPointerEnter, onTouchStart, onFocus, ...props },
  ref,
) {
  const [intencion, setIntencion] = React.useState(false);
  return (
    <Link
      ref={ref}
      {...props}
      prefetch={intencion}
      onPointerEnter={(e) => {
        setIntencion(true);
        onPointerEnter?.(e);
      }}
      onTouchStart={(e) => {
        setIntencion(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setIntencion(true);
        onFocus?.(e);
      }}
    />
  );
});
