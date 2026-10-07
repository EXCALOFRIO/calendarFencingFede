/**
 * Fechas del catálogo nacional (skermo RFEE) para los PDF que no imprimen fecha en la cabecera.
 * Sin disco: el lote manual lo carga del inventario y la ingesta automática lo arma con el índice de Skermo.
 *
 * El inventario nacional enlaza cada PDF (`readingUnits[].sourceUrl`) con las filas del
 * catálogo que lo publican (`datos.refOriginal` = `ownRfeeCatalog[].claveCatalogo`); cada
 * fila trae la fecha, el arma, el género, la categoría y el formato de la prueba.
 */

export type FilaCatalogo = {
  temporada: string;
  fecha: string;
  arma: string | null;
  genero: string | null;
  categoria: string | null;
  formato: string | null;
};

export type InventarioNacional = {
  ownRfeeCatalog?: {
    claveCatalogo: string; temporada: string; fecha?: string | null; arma?: string | null; genero?: string | null;
    categoria?: string | null; formato?: string | null;
  }[];
  readingUnits?: { sourceUrl: string; season?: string; datos?: { refOriginal?: string | null } }[];
  ownRfeeReadingUnits?: { sourceUrl: string; season?: string; datos?: { refOriginal?: string | null } }[];
};

/** `temporada|url sin fragmento` → filas del catálogo con fecha que enlazan ese PDF. */
export type IndiceFechas = Map<string, FilaCatalogo[]>;

const sinFragmento = (url: string) => url.split('#')[0];
const clave = (temporada: string, url: string) => `${temporada}|${sinFragmento(url)}`;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function indiceFechas(inv: InventarioNacional): IndiceFechas {
  const catalogo = new Map((inv.ownRfeeCatalog ?? []).map((c) => [c.claveCatalogo, c]));
  const indice: IndiceFechas = new Map();
  const vistos = new Set<string>();
  for (const u of [...(inv.readingUnits ?? []), ...(inv.ownRfeeReadingUnits ?? [])]) {
    const c = u.datos?.refOriginal ? catalogo.get(u.datos.refOriginal) : undefined;
    if (!c || !c.fecha || !FECHA.test(c.fecha)) continue;
    // Una fila del catálogo sólo fecha el PDF de su misma temporada.
    const k = clave(c.temporada, u.sourceUrl);
    const id = `${k}|${c.claveCatalogo}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const lista = indice.get(k) ?? [];
    lista.push({
      temporada: c.temporada, fecha: c.fecha, arma: c.arma ?? null, genero: c.genero ?? null,
      categoria: c.categoria ?? null, formato: c.formato ?? null,
    });
    indice.set(k, lista);
  }
  return indice;
}

export type PruebaFecha = { weapon: string; gender: string; category: string; format: string };

/**
 * Inicio y fin de la edición (fechas extremas de las filas del PDF) y fecha de una prueba:
 * la de las filas con su arma, género, formato y categoría si coinciden en una sola fecha,
 * o la única fecha del PDF. Nunca se adivina entre varias.
 */
export function fechasCatalogo(
  indice: IndiceFechas | null,
  temporada: string,
  url: string,
  prueba?: PruebaFecha,
): { inicio: string | null; fin: string | null; prueba: string | null } {
  const filas = indice?.get(clave(temporada, url)) ?? [];
  const todas = [...new Set(filas.map((f) => f.fecha))].sort();
  if (todas.length === 0) return { inicio: null, fin: null, prueba: null };
  let fechaPrueba: string | null = todas.length === 1 ? todas[0] : null;
  if (prueba) {
    const propias = [...new Set(filas.filter((f) =>
      f.arma === prueba.weapon && f.genero === prueba.gender && f.formato === prueba.format &&
      f.categoria === prueba.category).map((f) => f.fecha))];
    if (propias.length === 1) fechaPrueba = propias[0];
    else if (propias.length > 1) fechaPrueba = null;
  }
  return { inicio: todas[0], fin: todas.at(-1)!, prueba: fechaPrueba };
}
