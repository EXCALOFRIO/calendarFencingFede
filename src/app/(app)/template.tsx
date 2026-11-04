'use client';

import { usePathname } from 'next/navigation';
import { TransicionPagina } from '@/components/sistema/transicion';

/**
 * Transición de página para todas las pantallas (`docs/diseno-sistema.md`
 * § 4). Va en una plantilla y no en el layout porque la plantilla se vuelve a
 * montar al cambiar de sección (`/` → `/explorar` → `/ranking`), y eso es lo
 * que dispara la entrada y la salida de `<ViewTransition>`. Dentro de
 * `/explorar` lo hace su propia plantilla. Un cambio de consulta (`?mes=`,
 * `?q=`) no remonta nada y no anima.
 *
 * EXCEPTO `/`: el calendario es con diferencia el árbol más grande de la
 * aplicación (miles de nodos) y capturarlo entero para la View Transition —
 * hay que renderizarlo para la imagen, a la entrada y a la salida— costaba
 * más que montarlo. Esa pantalla entra y sale directa; el armazón sigue
 * animando su parte, que tiene nombre propio (`cabecera`, `barra-inferior`).
 */
export default function Plantilla({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  return ruta === '/' ? children : <TransicionPagina>{children}</TransicionPagina>;
}
