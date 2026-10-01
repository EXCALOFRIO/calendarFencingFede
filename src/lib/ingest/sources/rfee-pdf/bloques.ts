import { agruparFilas, fusionarFragmentos, limpiarItems, normalizar, textoFila, type Fila } from './geometria';
import { RE_COLUMNA_PUESTO, RE_PUESTO_TEXTO } from './clasificacion';
import type { PaginaTexto } from './tipos';

/**
 * Hay PDFs (los Criterium por año de nacimiento) con VARIAS pruebas en una
 * misma página: cada una con su cabecera, su «Clasificación general final» y
 * sus filas. Una página así se parte en bloques horizontales, uno por prueba,
 * conservando las coordenadas originales para que las regiones citadas sigan
 * apuntando a la página real.
 */

const RE_FINAL = /^(CLASIFICACI.{1,3}N GENERAL|CLASSIFICACI.{1,3} GENERAL)\b/;

const esFilaDePuesto = (f: Fila): boolean => {
  if (f.items.length < 2) return false;
  const p = f.items[0].s.trim();
  return /^\d{1,4}$/.test(p) || RE_PUESTO_TEXTO.test(normalizar(p));
};

const esCabeceraDeTabla = (f: Fila): boolean => RE_COLUMNA_PUESTO.test(normalizar(f.items[0].s));

/** Parte la página si contiene más de una clasificación final; si no, la devuelve igual. */
export function dividirPaginaPorPruebas(pagina: PaginaTexto): PaginaTexto[] {
  const items = limpiarItems(pagina.items);
  const filas = agruparFilas(items).map((f): Fila => ({ y: f.y, items: fusionarFragmentos(f.items) }));
  const titulos = filas.flatMap((f, k) => (RE_FINAL.test(normalizar(textoFila(f))) ? [k] : []));
  if (titulos.length < 2) return [pagina];

  // Primera fila de cabecera de cada bloque a partir del segundo: las filas
  // que quedan entre la última fila de puesto del bloque anterior y su título.
  const cortes: number[] = [];
  for (let t = 1; t < titulos.length; t += 1) {
    let k = titulos[t];
    while (k - 1 > titulos[t - 1] && !esFilaDePuesto(filas[k - 1]) && !esCabeceraDeTabla(filas[k - 1])) k -= 1;
    if (k === titulos[t]) return [pagina];
    cortes.push((filas[k].y + filas[k - 1].y) / 2);
  }

  const limites = [Number.POSITIVE_INFINITY, ...cortes, Number.NEGATIVE_INFINITY];
  return limites.slice(0, -1).map((arriba, b) => ({
    ...pagina,
    items: pagina.items.filter((i) => i.y < arriba && i.y >= limites[b + 1]),
  }));
}
