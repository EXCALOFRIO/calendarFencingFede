import { CalendarDays, CircleUserRound, Compass, Search, Trophy } from 'lucide-react';
import { pestanaActiva, rutaMadre, type DestinoBarra } from '@/components/sistema/navegacion';
import { RUTA_EDICIONES } from '@/lib/sport/explorar/catalogo-url';
import { RUTA_FAVORITOS } from '@/lib/sport/explorar/favoritos-url';
import { RUTA_INICIO, RUTA_YO } from '@/lib/sport/explorar/inicio-url';
import { RUTA_SIGUIENDO } from '@/lib/sport/explorar/siguiendo-url';
import { CLAVES_CRITERIO, RUTA_BUSCAR } from '@/lib/sport/explorar/url';

/**
 * Navegación de toda la aplicación (`docs/diseno-sistema.md` § 1): los cinco
 * destinos de la barra, qué pestaña marca cada ruta y qué cabecera lleva cada
 * pantalla. Sin React, para probarlo solo.
 *
 * Los cinco destinos son los mismos para todos los papeles. Lo que depende
 * del papel (Mi estado, Tiradores, Gestión) son filas de «Tú».
 */
export type ClavePestana = 'calendario' | 'explorar' | 'buscar' | 'ranking' | 'tu';

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
  { clave: 'explorar', href: RUTA_INICIO, etiqueta: 'Explorar', icono: Compass },
  { clave: 'buscar', href: RUTA_BUSCAR, etiqueta: 'Buscar', icono: Search, prefijos: [RUTA_EDICIONES] },
  { clave: 'ranking', href: '/ranking', etiqueta: 'Ranking', icono: Trophy },
  { clave: 'tu', href: RUTA_YO, etiqueta: 'Tú', icono: CircleUserRound, prefijos: DE_TU },
];

/** ¿La consulta trae algún criterio de búsqueda? `/explorar?q=…` es Buscar, no el feed. */
export function hayBusqueda(params: Pick<URLSearchParams, 'has'> | null | undefined): boolean {
  return Boolean(params && CLAVES_CRITERIO.some((clave) => params.has(clave)));
}

/**
 * Pestaña marcada. Igual que `pestanaActiva` del sistema salvo `/explorar`
 * con una búsqueda en la URL, que es la lista completa de Buscar.
 * `/notificaciones` no marca ninguna: se abre desde la campana. La ficha
 * propia (`fichaPropia`, ver `ficha-propia.ts`) y sus secciones marcan «Tú»,
 * de donde se abre como «Mi perfil deportivo».
 */
export function pestanaDeRuta(pathname: string, conBusqueda: boolean, fichaPropia: string | null = null): ClavePestana | null {
  if (pathname === RUTA_INICIO && conBusqueda) return 'buscar';
  if (esFichaPropia(pathname, fichaPropia)) return 'tu';
  return pestanaActiva(pathname, DESTINOS_APP) as ClavePestana | null;
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
    };

const segmentos = (pathname: string) => pathname.split('/').filter(Boolean);

/**
 * Cabecera compacta de cada pantalla. Las pantallas que todavía pintan su
 * propio título (calendario, ficha, ajustes…) reciben una cabecera
 * sin título, o ninguna si son la raíz de una pestaña: así no salen dos
 * encabezados iguales seguidos. Cuando cada área pase su título a la
 * cabecera, basta con darle aquí su texto.
 *
 * `volverA` es adonde sube «Volver» si la pantalla se abrió con un enlace
 * directo; si se llegó navegando, la flecha vuelve por historial.
 */
export function cabeceraDeRuta(pathname: string, conBusqueda: boolean, fichaPropia: string | null = null): CabeceraDeRuta | null {
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  if (ruta === '/') return { variante: 'raiz', titulo: 'Calendario', marca: true, campana: true };
  if (ruta === RUTA_INICIO) return conBusqueda ? { variante: 'raiz', titulo: 'Buscar' } : { variante: 'raiz', titulo: 'Explorar', campana: true };
  if (ruta === RUTA_BUSCAR || ruta === RUTA_EDICIONES) return { variante: 'raiz', titulo: 'Buscar' };
  if (ruta === RUTA_YO) return { variante: 'raiz', titulo: 'Tú' };
  if (ruta === '/ranking') return { variante: 'raiz', titulo: 'Ranking' };
  if (ruta === RUTA_SIGUIENDO || ruta === RUTA_FAVORITOS) return { variante: 'subpantalla', titulo: 'Siguiendo', volverA: RUTA_YO };
  // La edición y su prueba (`?prueba=`) son la misma pantalla: el nombre del torneo va en el contenido.
  if (ruta.startsWith(`${RUTA_EDICIONES}/`)) return { variante: 'subpantalla', titulo: 'Competición', volverA: RUTA_EDICIONES };

  const partes = segmentos(ruta);
  if (partes[0] === 'explorar' && partes[1]) {
    // `/explorar/[personaId]/cara-a-cara` vuelve a la ficha; la ficha y sus secciones, a Explorar.
    if (partes[2] === 'cara-a-cara') return { variante: 'subpantalla', titulo: 'Cara a cara', volverA: `/explorar/${partes[1]}` };
    // La ficha propia cuelga de «Tú» (Mi perfil deportivo); el nombre de la persona va en el contenido.
    return { variante: 'subpantalla', titulo: 'Perfil', volverA: esFichaPropia(ruta, fichaPropia) ? RUTA_YO : RUTA_INICIO };
  }
  if (ruta === '/notificaciones') return { variante: 'subpantalla', titulo: 'Notificaciones', volverA: '/' };
  // Se abre desde el engranaje de la bandeja: con un enlace directo, «Volver» sube a ella.
  if (ruta === '/ajustes/notificaciones') return { variante: 'subpantalla', titulo: 'Ajustes', volverA: '/notificaciones' };
  if (partes[0] === 'admin' && partes.length > 1) return { variante: 'subpantalla', titulo: null, volverA: '/admin' };
  if (DE_TU.some((base) => ruta === base || ruta.startsWith(`${base}/`))) return { variante: 'subpantalla', titulo: null, volverA: RUTA_YO };
  return { variante: 'subpantalla', titulo: null, volverA: rutaMadre(ruta) };
}
