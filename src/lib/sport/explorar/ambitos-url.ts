import { CRITERIOS_CATALOGO_VACIOS, RUTA_EDICIONES, urlCatalogo } from './catalogo-url';
import { RUTA_INICIO } from './inicio-url';
import { CRITERIOS_VACIOS, RUTA_BUSCAR, RUTA_BUSCAR_PAISES, construirUrlBuscar } from './url';

/**
 * Los cuatro ámbitos de la pestaña Explorar, que comparten cabecera (campo de
 * búsqueda y selector): «Para ti» (`/explorar`), Tiradores
 * (`/explorar/buscar`), Competiciones (`/explorar/ediciones`) y Países
 * (`/explorar/buscar?ver=paises`). Cambiar de ámbito sustituye la entrada del
 * historial y conserva lo escrito (`q`), salvo en «Para ti», que no busca.
 */
export type AmbitoExplorar = 'inicio' | 'personas' | 'competiciones' | 'paises';

export const AMBITOS: readonly { valor: AmbitoExplorar; etiqueta: string; raiz: string }[] = [
  { valor: 'inicio', etiqueta: 'Para ti', raiz: RUTA_INICIO },
  { valor: 'personas', etiqueta: 'Tiradores', raiz: RUTA_BUSCAR },
  // «Competiciones» no cabe en un cuarto de 360 px; el título de la pantalla sí lo dice entero.
  { valor: 'competiciones', etiqueta: 'Torneos', raiz: RUTA_EDICIONES },
  { valor: 'paises', etiqueta: 'Países', raiz: RUTA_BUSCAR_PAISES },
];

const LIMPIAR = (q: string | null | undefined, maximo: number) => (q ?? '').replace(/\s+/g, ' ').trim().slice(0, maximo);

/** Países con lo escrito en su campo: `/explorar/buscar?ver=paises&q=ita`. */
export function urlPaises(q?: string | null): string {
  const texto = LIMPIAR(q, 40);
  return texto ? `${RUTA_BUSCAR_PAISES}&${new URLSearchParams({ q: texto }).toString()}` : RUTA_BUSCAR_PAISES;
}

/** Dirección de un ámbito conservando lo escrito. Sin texto, la raíz del ámbito. */
export function urlAmbito(ambito: AmbitoExplorar, q?: string | null): string {
  const texto = LIMPIAR(q, 80);
  switch (ambito) {
    case 'inicio':
      return RUTA_INICIO;
    case 'personas':
      return construirUrlBuscar({ ...CRITERIOS_VACIOS, q: texto });
    case 'competiciones':
      return urlCatalogo({ ...CRITERIOS_CATALOGO_VACIOS, q: texto });
    case 'paises':
      return urlPaises(texto);
  }
}

/** Adónde envía el campo de búsqueda de cada ámbito: desde «Para ti» se buscan tiradores. */
export function destinoBusqueda(ambito: AmbitoExplorar, q: string): string {
  return urlAmbito(ambito === 'inicio' ? 'personas' : ambito, q);
}
