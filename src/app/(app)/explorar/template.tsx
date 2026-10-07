import { TransicionPagina } from '@/components/sistema/transicion';

/**
 * Explorar tiene varias pestañas y subpantallas bajo el mismo segmento
 * (`/explorar`, `/explorar/buscar`, `/explorar/yo`, la ficha): la plantilla
 * de `(app)` no se remonta entre ellas, ésta sí. Las secciones de una ficha
 * (`/explorar/[id]/rivales`) comparten segmento y no animan, como pestañas
 * de la misma pantalla.
 */
export default function Plantilla({ children }: { children: React.ReactNode }) {
  return <TransicionPagina>{children}</TransicionPagina>;
}
