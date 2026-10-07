/**
 * Filas de celdas de una página PDF a partir de sus trozos de texto con
 * posición. Las listas en PDF de varias federaciones (Austria, Rumanía,
 * Turquía) escriben cada celda como un trozo propio; al unir el texto de la
 * página se pierde dónde acaba el apellido y empieza el club. Aquí se agrupan
 * los trozos por altura (misma línea si la `y` difiere 2 puntos o menos) y se
 * ordenan por `x`.
 */

export type TrozoPdf = { s: string; x: number; y: number };
export type Celda = { s: string; x: number };

const TOLERANCIA_Y = 2;

/** Ítem de texto de pdf.js: `transform` es la matriz `[a, b, c, d, x, y]`. */
export type ItemPdf = { str: string; transform: number[] };

/**
 * Trozos con posición de los ítems de una página. Si la mayoría del texto va
 * girado 90° (páginas apaisadas de algunas temporadas antiguas del ÖFV), las filas
 * avanzan en `x` y las columnas en `y`: se giran para que `filasCeldas` las
 * agrupe igual que en una página normal.
 */
export function trozosPagina(items: readonly ItemPdf[]): TrozoPdf[] {
  const conTexto = items.filter((it) => it.str.trim());
  const girada = conTexto.filter((it) => it.transform[0] === 0 && it.transform[1] > 0).length > conTexto.length / 2;
  return conTexto.map((it) => (girada
    ? { s: it.str, x: it.transform[5], y: -it.transform[4] }
    : { s: it.str, x: it.transform[4], y: it.transform[5] }));
}

export function filasCeldas(trozos: readonly TrozoPdf[]): Celda[][] {
  const lineas: { y: number; celdas: Celda[] }[] = [];
  for (const t of trozos) {
    const s = t.s.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    let linea = lineas.find((l) => Math.abs(l.y - t.y) <= TOLERANCIA_Y);
    if (!linea) {
      linea = { y: t.y, celdas: [] };
      lineas.push(linea);
    }
    linea.celdas.push({ s, x: t.x });
  }
  // De arriba abajo: en PDF la `y` crece hacia arriba.
  lineas.sort((a, b) => b.y - a.y);
  return lineas.map((l) => l.celdas.sort((a, b) => a.x - b.x));
}

/** «56,5» o «59.75» a texto con dos decimales como mucho; `null` si no es un número. */
export function puntosPdf(v: string | undefined): string | null {
  const t = (v ?? '').trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return String(Math.round(Number(t) * 100) / 100);
}
