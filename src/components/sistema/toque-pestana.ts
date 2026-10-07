'use client';

import { useRouter } from 'next/navigation';
import { recordarPestana, urlActual } from './memoria-pestanas';
import {
  ATRIBUTO_VUELTA,
  TIPO_TRANSICION,
  esRaizDe,
  hayCapaAbierta,
  indiceRaizEnHistorial,
  raizRecordada,
  type DestinoBarra,
  type ToquePestana,
} from './navegacion';

/**
 * Lo que comparten la barra del móvil y las pastillas del escritorio al
 * guardar la memoria de una pestaña y al tocar la pestaña activa. La regla de
 * qué ruta es de qué pestaña la da quien pinta la barra (`deLaPestana`).
 */

/** ¿`url` es de la pestaña `clave`? Sin regla, se fía de la pestaña marcada. */
export type DeLaPestana = (clave: string, url: string) => boolean;

/**
 * Guarda la dirección actual como la última de `marcada`, sólo si de verdad
 * es suya con lo que se sabe ahora; y, si es su raíz, también como la raíz
 * con la que se dejó (el mes y los filtros del calendario).
 */
export function recordarSiEsSuya(
  destinos: readonly DestinoBarra[],
  marcada: string | null,
  deLaPestana: DeLaPestana | undefined,
  url: string = urlActual(),
): void {
  if (!marcada) return;
  if (deLaPestana && !deLaPestana(marcada, url)) return;
  recordarPestana(marcada, url);
  const destino = destinos.find((d) => d.clave === marcada);
  if (destino && esRaizDe(destino, url)) recordarPestana(raizRecordada(marcada), url);
}

type Router = { replace: (href: string, opciones?: { transitionTypes?: string[] }) => void };

/**
 * El router de Next, o `null` fuera de él (la página de muestra y los arneses
 * pintan la barra sin aplicación): `useRouter` lanza en vez de devolver nada.
 * `useContext` se llama igual en los dos casos, así que el orden de hooks no cambia.
 */
export function useRouterOpcional(): Router | null {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

const SIN_ROUTER: Router = { replace: (href) => window.location.replace(href) };

type NavegacionApi = {
  currentEntry?: { index: number } | null;
  entries?: () => { url: string | null }[];
};

function rutaDe(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin === window.location.origin ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

/**
 * Tocar la pestaña activa desde una subpantalla: vuelve a su raíz SIN una
 * entrada nueva. Si la raíz está detrás en el historial y todo lo de en medio
 * es de esta pestaña, se vuelve hasta ella (como «atrás» varias veces, con su
 * desplazamiento y sus filtros); si no, la entrada actual se sustituye por la
 * raíz. En los dos casos «atrás» desde la raíz sale de la pestaña, no vuelve
 * a la subpantalla.
 */
export function volverARaiz(destino: DestinoBarra, raiz: string, deLaPestana: DeLaPestana | undefined, router: Router | null): void {
  const nav = (window as unknown as { navigation?: NavegacionApi }).navigation;
  const actual = nav?.currentEntry?.index;
  if (nav?.entries && typeof actual === 'number') {
    const urls = nav.entries().map((e) => rutaDe(e.url));
    const j = indiceRaizEnHistorial(urls, actual, destino, (u) => !deLaPestana || deLaPestana(destino.clave, u));
    if (j !== null) {
      const html = document.documentElement;
      html.setAttribute(ATRIBUTO_VUELTA, 'atras');
      window.setTimeout(() => html.removeAttribute(ATRIBUTO_VUELTA), 700);
      window.history.go(j - actual);
      return;
    }
  }
  (router ?? SIN_ROUTER).replace(raiz, { transitionTypes: [TIPO_TRANSICION.volver] });
}

/**
 * El clic en una pestaña. Devuelve `true` si lo ha resuelto aquí (y el
 * enlace no debe navegar).
 */
export function resolverToque(o: {
  toque: ToquePestana;
  destino: DestinoBarra;
  href: string;
  deLaPestana: DeLaPestana | undefined;
  router: Router | null;
}): boolean {
  if (o.toque.accion === 'navegar') return false;
  if (o.toque.accion === 'raiz') {
    recordarPestana(o.destino.clave, o.href);
    volverARaiz(o.destino, o.href, o.deLaPestana, o.router);
    return true;
  }
  // En la raíz: si hay una capa abierta encima (la ficha del calendario), se cierra; si no, se sube.
  if (hayCapaAbierta(window.history.state)) {
    window.history.back();
    return true;
  }
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: quieto ? 'auto' : 'smooth' });
  return true;
}
