import { TransicionPagina } from '@/components/sistema/transicion';

/**
 * Transición de página para todas las pantallas (`docs/diseno-sistema.md`
 * § 4). Va en una plantilla y no en el layout porque la plantilla se vuelve a
 * montar al cambiar de sección (`/` → `/explorar` → `/ranking`), y eso es lo
 * que dispara la entrada y la salida de `<ViewTransition>`. Dentro de
 * `/explorar` lo hace su propia plantilla. Un cambio de consulta (`?mes=`,
 * `?q=`) no remonta nada y no anima.
 */
export default function Plantilla({ children }: { children: React.ReactNode }) {
  return <TransicionPagina>{children}</TransicionPagina>;
}
