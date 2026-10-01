import { docIdDeUrl } from '../sources/rfee-pdf/lectura';
import type { FilaCatalogo } from '../sources/historico-indice';
import type { UnidadDescubierta } from './plan';

/**
 * Del catálogo derivado del inventario (FIE/Skermo) a unidades de lectura del
 * backfill. Es pura y no lee red: el catálogo ya viene descubierto.
 *
 *  - FIE y la clasificación HTML de Skermo dan una unidad por prueba;
 *  - cada PDF enlazado desde el índice de Skermo es una unidad documento. Sólo
 *    Skermo: los PDF de invitación de la FIE no son resultados. La referencia
 *    de la fila del índice viaja con la URL para que el documento no herede el
 *    título único de una fila cuando contiene varias pruebas.
 *
 * Que el índice enlace algo no prueba que haya resultados: la unidad sólo pasa
 * a ser trabajo pendiente, y la lectura decide si hay puestos o asaltos.
 */

export type FiltroUnidades = { fuentes?: readonly string[]; temporadas?: readonly string[] };

const FUENTES_SKERMO = new Set(['skermo_rfee', 'skermo_regional']);

export const claveDocumentoPdf = (url: string): string => `doc:${docIdDeUrl(url)}`;

export function unidadesDesdeCatalogo(
  catalogo: readonly FilaCatalogo[],
  filtro: FiltroUnidades = {},
): UnidadDescubierta[] {
  const unidades: UnidadDescubierta[] = [];
  const vistas = new Set<string>();
  const posicion = new Map<string, number>();
  const anadir = (u: UnidadDescubierta) => {
    if (filtro.fuentes?.length && !filtro.fuentes.includes(u.fuente)) return;
    if (filtro.temporadas?.length && !filtro.temporadas.includes(u.season)) return;
    const clave = `${u.fuente}|${u.season}|${u.competitionKey}`;
    if (vistas.has(clave)) return;
    vistas.add(clave);
    unidades.push(u);
  };

  for (const fila of catalogo) {
    const grupo = `${fila.fuente}|${fila.federacion}|${fila.temporada}`;
    const indice = (posicion.get(grupo) ?? 0) + 1;
    posicion.set(grupo, indice);

    if (fila.clavePrueba) {
      const principal = fila.enlaces.find((e) => e.tipo === (fila.fuente === 'fie' ? 'api' : 'html'));
      anadir({
        fuente: fila.fuente,
        season: fila.temporada,
        competitionKey: fila.clavePrueba,
        sourceUrl: principal?.url ?? null,
        datos: { refOriginal: fila.claveCatalogo, indice },
      });
    }
    if (!FUENTES_SKERMO.has(fila.fuente)) continue;
    for (const enlace of fila.enlaces.filter((e) => e.tipo === 'pdf')) {
      anadir({
        fuente: 'rfee_pdf',
        season: fila.temporada,
        competitionKey: claveDocumentoPdf(enlace.url),
        sourceUrl: enlace.url,
        datos: { refOriginal: fila.claveCatalogo, indice, titulo: fila.nombre || null },
      });
    }
  }
  return unidades;
}
