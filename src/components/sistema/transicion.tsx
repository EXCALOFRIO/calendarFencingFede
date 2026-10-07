import { ViewTransition } from 'react';
import { TIPO_TRANSICION } from './navegacion';

/**
 * Contenedores de transición (`docs/diseno-sistema.md` § 4). Usan
 * `<ViewTransition>` de React, que Next activa en cada navegación porque las
 * navegaciones son Transitions. Las animaciones están en `sistema.css`.
 *
 * Sin soporte del navegador no animan y la pantalla cambia igual.
 */

/**
 * Clase por tipo. Lo que llega sin tipo (atrás del navegador, gesto de iOS)
 * recibe `nav-historial`, que no anima: iOS ya pinta su propio deslizamiento
 * y dos animaciones encima se ven como un parpadeo. El botón de volver de la
 * cabecera marca `<html data-navegacion="atras">` y entonces sí desliza.
 */
export const CLASES_PAGINA = {
  [TIPO_TRANSICION.avanzar]: 'nav-avanzar',
  [TIPO_TRANSICION.volver]: 'nav-volver',
  [TIPO_TRANSICION.pestana]: 'nav-pestana',
  default: 'nav-historial',
} as const;

/**
 * Envuelve el contenido de una `page.tsx` (no del layout: un layout no se
 * desmonta al navegar y nunca dispararía la entrada ni la salida). La
 * cabecera de la pantalla va FUERA, para que se quede quieta.
 */
export function TransicionPagina({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={CLASES_PAGINA} exit={CLASES_PAGINA} default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * Fundido corto para un cambio dentro de la misma pantalla (otro arma, otra
 * temporada): misma página, otro contenido. `clave` es lo que cambia; con
 * una clave nueva React trata el bloque viejo y el nuevo como una pareja.
 */
export function TransicionContenido({
  clave,
  nombre,
  children,
}: {
  clave: string;
  /** Único en la pantalla. */
  nombre: string;
  children: React.ReactNode;
}) {
  return (
    <ViewTransition key={clave} name={nombre} share="sis-fundido" enter="sis-fundido" exit="sis-fundido" default="none">
      {children}
    </ViewTransition>
  );
}
