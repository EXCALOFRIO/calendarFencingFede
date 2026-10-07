'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { TransicionContenido } from '@/components/sistema/transicion';

/**
 * Fundido corto al cambiar de sección del perfil (misma pantalla, otro
 * contenido: `docs/diseno-sistema.md` § 4). Las secciones comparten el
 * segmento de la ficha y la plantilla de Explorar no se remonta entre ellas;
 * la clave es la sección de la URL. Con movimiento reducido el fundido dura 0
 * (`sistema.css`).
 */
export function TransicionSeccion({ children }: { children: React.ReactNode }) {
  const seccion = useSelectedLayoutSegment() ?? 'resultados';
  return (
    <TransicionContenido clave={seccion} nombre="perfil-seccion">
      {children}
    </TransicionContenido>
  );
}
