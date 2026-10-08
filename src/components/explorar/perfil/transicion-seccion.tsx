'use client';

import { useSelectedLayoutSegment } from 'next/navigation';

/**
 * Fundido corto al cambiar de sección del perfil, sólo con `opacity`
 * (`.sis-aparecer`, que el movimiento reducido apaga en `sistema.css`).
 *
 * No es una View Transition a propósito: una con nombre sobre la sección
 * entera obligaba al navegador a fotografiar cientos de nodos (los gráficos
 * de Estadísticas) antes de pintar, y en un móvil lento eso bloqueaba el
 * hilo principal más que el propio cambio. La clave es la sección de la URL.
 */
export function TransicionSeccion({ children }: { children: React.ReactNode }) {
  const seccion = useSelectedLayoutSegment() ?? 'resultados';
  return (
    <div key={seccion} data-seccion-perfil={seccion} className="sis-aparecer min-w-0">
      {children}
    </div>
  );
}
