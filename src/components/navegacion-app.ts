import { CalendarDays, CircleUserRound, Compass, Trophy } from 'lucide-react';
import { pestanaActiva, rutaMadre, type DestinoBarra } from '@/components/sistema/navegacion';
import { RUTA_EDICIONES } from '@/lib/sport/explorar/catalogo-url';
import { RUTA_FAVORITOS } from '@/lib/sport/explorar/favoritos-url';
import { RUTA_INICIO, RUTA_YO } from '@/lib/sport/explorar/inicio-url';
import { RUTA_SIGUIENDO } from '@/lib/sport/explorar/siguiendo-url';
import { CLAVES_CRITERIO, RUTA_BUSCAR, RUTA_BUSCAR_PAISES } from '@/lib/sport/explorar/url';

/**
 * Navegación de toda la aplicación (`docs/diseno-sistema.md` § 1): los cuatro
 * destinos de la barra, qué pestaña marca cada ruta y qué cabecera lleva cada
 * pantalla. Sin React, para probarlo solo.
 *
 * Explorar es búsqueda y descubrimiento a la vez, como en Instagram: «Para ti»
 * (`/explorar`), Tiradores (`/explorar/buscar`), Competiciones
 * (`/explorar/ediciones`) y Países son ámbitos de la misma pestaña. Los
 * destinos son los mismos para todos los papeles; lo que depende del papel
 * (Mi estado, Tiradores, Gestión) son filas de «Tú».
 */
export type ClavePestana = 'calendario' | 'explorar' | 'ranking' | 'tu';

/** Pantallas que cuelgan de «Tú» aunque vivan fuera de `/explorar/yo`. */
const DE_TU = [
  RUTA_SIGUIENDO,
  RUTA_FAVORITOS,
  '/perfil',
  '/estado',
  '/ajustes',
  '/convocatorias',
  '/tiradores',
  '/admin',
  '/alta',
  '/documentos',
] as const;

export const DESTINOS_APP: readonly (DestinoBarra & { clave: ClavePestana })[] = [
  { clave: 'calendario', href: '/', etiqueta: 'Calendario', icono: CalendarDays },
  // `/explorar/buscar` y `/explorar/ediciones` cuelgan de `/explorar`: no hacen falta prefijos.
  { clave: 'explorar', href: RUTA_INICIO, etiqueta: 'Explorar', icono: Compass },
  { clave: 'ranking', href: '/ranking', etiqueta: 'Ranking', icono: Trophy },
  { clave: 'tu', href: RUTA_YO, etiqueta: 'Tú', icono: CircleUserRound, prefijos: DE_TU },
];

/** Raíz de la pestaña `clave`, o `null` si no es una pestaña de la barra (p. ej. la «buscar» de antes). */
export function raizDePestana(clave: string | null | undefined): string | null {
  return DESTINOS_APP.find((d) => d.clave === clave)?.href ?? null;
}

/**
 * ¿La consulta trae algún criterio de búsqueda? Ya no cambia la pestaña
 * (`/explorar?q=…` redirige a Tiradores, dentro de Explorar); se conserva
 * para quien todavía lo pase.
 */
export function hayBusqueda(params: Pick<URLSearchParams, 'has'> | null | undefined): boolean {
  return Boolean(params && CLAVES_CRITERIO.some((clave) => params.has(clave)));
}

/**
 * Pestaña marcada: la de `pestanaActiva` del sistema. `/notificaciones` no
 * marca ninguna: se abre desde la campana. La ficha propia (`fichaPropia`,
 * ver `ficha-propia.ts`) y sus secciones marcan «Tú», de donde se abre como
 * «Mi perfil deportivo». `_conBusqueda` ya no cuenta (ver `hayBusqueda`).
 */
export function pestanaDeRuta(
  pathname: string,
  _conBusqueda: boolean = false,
  fichaPropia: string | null = null,
  /** Pestaña desde la que se abrió una ruta neutra (`herencia-pestanas.ts`). */
  heredada: string | null = null,
): ClavePestana | null {
  if (esFichaPropia(pathname, fichaPropia)) return 'tu';
  if (heredada && esRutaNeutra(pathname) && raizDePestana(heredada)) return heredada as ClavePestana;
  return pestanaActiva(pathname, DESTINOS_APP) as ClavePestana | null;
}

/** Segmentos de `/explorar/<x>` que son pantallas de una pestaña y no una persona. */
const PROPIOS_DE_EXPLORAR = new Set(['buscar', 'yo', 'siguiendo', 'favoritos']);

/**
 * Rutas que no son de ninguna pestaña: una persona (y sus secciones y su cara
 * a cara), una edición y un país. Como en Instagram, se quedan en la pestaña
 * desde la que se abrieron; abiertas con un enlace directo, marcan la de su
 * prefijo.
 */
export function esRutaNeutra(pathname: string): boolean {
  const partes = segmentos(pathname);
  if (partes[0] !== 'explorar' || !partes[1]) return false;
  if (partes[1] === 'ediciones') return Boolean(partes[2]);
  return !PROPIOS_DE_EXPLORAR.has(partes[1]);
}

/**
 * ¿Se guarda la dirección actual como la última de `marcada`? Sólo si, con
 * lo que se sabe AHORA (la ficha propia ya apuntada, la pestaña heredada), la
 * ruta es de esa pestaña. El primer pintado de la ficha propia marca Explorar
 * porque aún no se sabe que es la propia; sin esta comprobación, la memoria de
 * Explorar se quedaba con ella y la brújula llevaba siempre a la ficha propia.
 */
export function pestanaQueRecuerda(o: {
  marcada: string | null;
  pathname: string;
  conBusqueda: boolean;
  fichaPropia: string | null;
  heredada: string | null;
}): string | null {
  if (!o.marcada) return null;
  return pestanaDeRuta(o.pathname, false, o.fichaPropia, o.heredada) === o.marcada ? o.marcada : null;
}

/**
 * La memoria de las pestañas sin la ficha propia fuera de «Tú»: al
 * reconocerla, una pestaña que la recordaba (Explorar, casi siempre) vuelve a
 * su raíz. El cara a cara propio no es la ficha y se queda.
 */
export function sinFichaPropiaAjena(
  recordadas: Readonly<Record<string, string>>,
  fichaPropia: string,
): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, url] of Object.entries(recordadas)) {
    const ruta = url.split(/[?#]/)[0] ?? '';
    if (clave !== 'tu' && esFichaPropia(ruta, fichaPropia)) continue;
    salida[clave] = url;
  }
  return salida;
}

/** ¿`pathname` es la ficha propia (`/explorar/<id>`) o una de sus secciones? El cara a cara no. */
export function esFichaPropia(pathname: string, fichaPropia: string | null): boolean {
  if (!fichaPropia) return false;
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  if (ruta === fichaPropia) return true;
  if (!ruta.startsWith(`${fichaPropia}/`)) return false;
  return !ruta.slice(fichaPropia.length + 1).startsWith('cara-a-cara');
}

export type CabeceraDeRuta =
  | {
      variante: 'raiz';
      titulo: string;
      /** El logo con el nombre, sólo en la portada. */
      marca?: boolean;
      campana?: boolean;
    }
  | {
      variante: 'subpantalla';
      /** `null` mientras la pantalla pinta su propio `<h1>`. */
      titulo: string | null;
      volverA: string;
      /** `false`: el título es un rótulo y el `<h1>` (el nombre real) lo pinta la pantalla. */
      encabezado?: boolean;
    };

const segmentos = (pathname: string) => pathname.split('/').filter(Boolean);

/** Rutas raíz de los ámbitos de Explorar: todas con la misma cabecera. */
const AMBITOS_EXPLORAR = new Set([RUTA_INICIO, RUTA_BUSCAR, RUTA_EDICIONES]);

/**
 * Cabecera compacta de cada pantalla. Las pantallas que todavía pintan su
 * propio título (calendario, ficha, ajustes…) reciben una cabecera
 * sin título, o ninguna si son la raíz de una pestaña: así no salen dos
 * encabezados iguales seguidos. Cuando cada área pase su título a la
 * cabecera, basta con darle aquí su texto.
 *
 * `volverA` es adonde sube «Volver» si la pantalla se abrió con un enlace
 * directo; si se llegó navegando, la flecha vuelve por historial. En una
 * ruta neutra (persona, edición, país) abierta desde otra pestaña
 * (`heredada`), sube a la raíz de esa pestaña: un perfil abierto desde el
 * Ranking vuelve al Ranking. `_conBusqueda` ya no cuenta.
 */
export function cabeceraDeRuta(
  pathname: string,
  _conBusqueda: boolean = false,
  fichaPropia: string | null = null,
  heredada: string | null = null,
): CabeceraDeRuta | null {
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  if (ruta === '/') return { variante: 'raiz', titulo: 'Calendario', marca: true, campana: true };
  if (AMBITOS_EXPLORAR.has(ruta)) return { variante: 'raiz', titulo: 'Explorar', campana: true };
  if (ruta === RUTA_YO) return { variante: 'raiz', titulo: 'Tú' };
  if (ruta === '/ranking') return { variante: 'raiz', titulo: 'Ranking' };
  if (ruta === RUTA_SIGUIENDO || ruta === RUTA_FAVORITOS) return { variante: 'subpantalla', titulo: 'Siguiendo', volverA: RUTA_YO };

  // Desde Explorar se vuelve al ámbito de la ruta; desde otra pestaña, a su raíz.
  const origen = heredada && heredada !== 'explorar' && esRutaNeutra(ruta) ? raizDePestana(heredada) : null;

  // La edición y su prueba (`?prueba=`) son la misma pantalla: el nombre del torneo va en el contenido.
  if (ruta.startsWith(`${RUTA_EDICIONES}/`)) return { variante: 'subpantalla', titulo: 'Competición', volverA: origen ?? RUTA_EDICIONES, encabezado: false };

  const partes = segmentos(ruta);
  // Ficha de país y cara a cara de selecciones: el nombre de los países va en el contenido.
  if (partes[0] === 'explorar' && partes[1] === 'pais' && partes[2]) {
    if (partes[3] === 'contra') return { variante: 'subpantalla', titulo: 'Selecciones', volverA: `/explorar/pais/${partes[2]}`, encabezado: false };
    return { variante: 'subpantalla', titulo: 'País', volverA: origen ?? RUTA_BUSCAR_PAISES, encabezado: false };
  }
  if (partes[0] === 'explorar' && partes[1]) {
    // `/explorar/[personaId]/cara-a-cara` vuelve a la ficha; la ficha y sus secciones, a Explorar.
    if (partes[2] === 'cara-a-cara') return { variante: 'subpantalla', titulo: 'Cara a cara', volverA: `/explorar/${partes[1]}`, encabezado: false };
    // La ficha propia cuelga de «Tú» (Mi perfil deportivo); el nombre de la persona va en el contenido.
    const volverA = esFichaPropia(ruta, fichaPropia) ? RUTA_YO : (origen ?? RUTA_INICIO);
    return { variante: 'subpantalla', titulo: 'Perfil', volverA, encabezado: false };
  }
  if (ruta === '/notificaciones') return { variante: 'subpantalla', titulo: 'Notificaciones', volverA: '/' };
  // Se abre desde el engranaje de la bandeja: con un enlace directo, «Volver» sube a ella.
  if (ruta === '/ajustes/notificaciones') return { variante: 'subpantalla', titulo: 'Ajustes', volverA: '/notificaciones' };
  if (partes[0] === 'admin' && partes.length > 1) return { variante: 'subpantalla', titulo: null, volverA: '/admin' };
  if (DE_TU.some((base) => ruta === base || ruta.startsWith(`${base}/`))) return { variante: 'subpantalla', titulo: null, volverA: RUTA_YO };
  return { variante: 'subpantalla', titulo: null, volverA: rutaMadre(ruta) };
}
