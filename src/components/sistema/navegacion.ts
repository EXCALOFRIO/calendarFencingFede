import type { ComponentType } from 'react';

/**
 * Reglas de navegación del sistema (`docs/diseno-sistema.md` § 1), sin React
 * para poder probarlas solas.
 *
 * Los tipos de transición son los que reciben `<Link transitionTypes>` y
 * `router.push(href, { transitionTypes })`, y los que lee `TransicionPagina`
 * para elegir la animación.
 */
export const TIPO_TRANSICION = {
  /** Entrar en algo: de una lista a una ficha. Desliza hacia la izquierda. */
  avanzar: 'nav-avanzar',
  /** Salir de algo: el botón de volver. Desliza hacia la derecha. */
  volver: 'nav-volver',
  /** Cambiar de pestaña en la barra: fundido corto, sin dirección. */
  pestana: 'nav-pestana',
} as const;

export type TipoTransicion = (typeof TIPO_TRANSICION)[keyof typeof TIPO_TRANSICION];

/**
 * Atributo que se pone en `<html>` justo antes de `router.back()`. Una vuelta
 * por historial no lleva tipo de transición, así que la CSS la reconoce por
 * este atributo y no por la clase.
 */
export const ATRIBUTO_VUELTA = 'data-navegacion';

export type DestinoBarra = {
  clave: string;
  href: string;
  etiqueta: string;
  icono: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  /** Otras rutas que también marcan esta pestaña (p. ej. `/explorar/ediciones` para Buscar). */
  prefijos?: readonly string[];
  /** Punto rojo de novedades. */
  insignia?: boolean;
};

function ruta(href: string): string {
  const sinConsulta = href.split(/[?#]/)[0] ?? '/';
  return sinConsulta.length > 1 ? sinConsulta.replace(/\/+$/, '') : '/';
}

function cuelgaDe(pathname: string, base: string): boolean {
  if (base === '/') return pathname === '/';
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Pestaña marcada: la del prefijo más largo que contiene la ruta. `/` sólo
 * marca la portada; si no, todas las rutas marcarían el calendario.
 */
export function pestanaActiva(pathname: string, destinos: readonly DestinoBarra[]): string | null {
  const actual = ruta(pathname);
  let mejor: { clave: string; largo: number } | null = null;
  for (const d of destinos) {
    for (const base of [ruta(d.href), ...(d.prefijos ?? []).map(ruta)]) {
      if (cuelgaDe(actual, base) && (!mejor || base.length > mejor.largo)) mejor = { clave: d.clave, largo: base.length };
    }
  }
  return mejor?.clave ?? null;
}

export type ToquePestana =
  | { accion: 'subir' }
  | { accion: 'navegar'; tipos: TipoTransicion[] };

/**
 * Lo que hace un toque en la barra, como en Instagram:
 * - otra pestaña: se cambia con fundido;
 * - la pestaña en la que ya estás, desde una subpantalla: vuelve a su raíz;
 * - la pestaña en la que ya estás, en su raíz: sube al principio.
 */
export function toquePestana(pathname: string, destino: DestinoBarra, activa: string | null): ToquePestana {
  if (destino.clave !== activa) return { accion: 'navegar', tipos: [TIPO_TRANSICION.pestana] };
  if (ruta(pathname) === ruta(destino.href)) return { accion: 'subir' };
  return { accion: 'navegar', tipos: [TIPO_TRANSICION.volver] };
}

/**
 * Cada pestaña recuerda dónde la dejaste (el mes y los filtros del
 * calendario, la ficha abierta en Explorar). La pestaña en la que estás
 * apunta siempre a su raíz.
 */
export function hrefDePestana(
  destino: DestinoBarra,
  activa: string | null,
  recordadas: Readonly<Record<string, string>>,
): string {
  if (destino.clave === activa) return destino.href;
  const r = recordadas[destino.clave];
  return r && r.startsWith('/') && !r.startsWith('//') ? r : destino.href;
}

export const CLAVE_RECORDADAS = 'sistema:pestanas';

/** Ruta madre: `/explorar/ediciones/abc` → `/explorar/ediciones`. */
export function rutaMadre(pathname: string): string {
  const partes = ruta(pathname).split('/').filter(Boolean);
  return partes.length <= 1 ? '/' : `/${partes.slice(0, -1).join('/')}`;
}

/**
 * Tipo para un enlace entre dos rutas: bajar en el árbol es avanzar, subir es
 * volver y un salto lateral no lleva dirección (devuelve `[]`).
 */
export function tiposEntre(desde: string, hasta: string): TipoTransicion[] {
  const a = ruta(desde);
  const b = ruta(hasta);
  if (a === b) return [];
  if (a === '/' || cuelgaDe(b, a)) return [TIPO_TRANSICION.avanzar];
  if (b === '/' || cuelgaDe(a, b)) return [TIPO_TRANSICION.volver];
  return [];
}

type HistorialNavegador = {
  navigation?: { currentEntry?: { index: number } | null; entries?: () => { url: string | null }[] };
  location: { origin: string };
};

/**
 * ¿La entrada anterior del historial es de esta aplicación? Con la Navigation
 * API se mira de verdad; sin ella se usa el recuento de pantallas vistas en
 * esta pestaña del navegador, que es lo que hacía `BotonAtras`.
 */
export function anteriorEsDeLaApp(w: HistorialNavegador, pantallasVistas: number): boolean {
  const nav = w.navigation;
  const indice = nav?.currentEntry?.index;
  if (nav?.entries && typeof indice === 'number') {
    if (indice <= 0) return false;
    const anterior = nav.entries()[indice - 1]?.url;
    if (!anterior) return false;
    try {
      return new URL(anterior).origin === w.location.origin;
    } catch {
      return false;
    }
  }
  return pantallasVistas > 1;
}
