import type { ItemTexto } from './tipos';

/**
 * Geometría de texto posicionado: filas, fragmentos y comparación de
 * nombres truncados. Todo es puro y trabaja sobre `ItemTexto`.
 */

export type Fila = { y: number; items: ItemTexto[] };

/** Tolerancia vertical para considerar que dos textos están en la misma fila. */
export const TOL_FILA = 1.6;

const REEMPLAZO = '\uFFFD';

/** Mayúsculas, sin tildes y con el carácter perdido (U+FFFD) como `?`. */
export function normalizar(s: string): string {
  return s
    .replaceAll(REEMPLAZO, '?')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function limpiarItems(items: readonly ItemTexto[]): ItemTexto[] {
  return items.filter((i) => i.s.trim().length > 0 && Number.isFinite(i.x) && Number.isFinite(i.y));
}

/**
 * Une fragmentos pegados dentro de una fila. PDF.js parte el texto donde el
 * PDF usa un carácter que no sabe decodificar (la «ñ» de algunos PDFs de
 * Engarde sale como U+FFFD suelto): el hueco entre fragmentos es cero.
 * Dos columnas distintas nunca están a menos de un punto.
 */
export function fusionarFragmentos(items: readonly ItemTexto[]): ItemTexto[] {
  const orden = [...items].sort((a, b) => a.x - b.x);
  const salida: ItemTexto[] = [];
  for (const it of orden) {
    const ult = salida[salida.length - 1];
    if (ult && it.x - (ult.x + ult.w) < 1 && it.x - (ult.x + ult.w) > -1.5) {
      salida[salida.length - 1] = { ...ult, s: ult.s + it.s, w: it.x + it.w - ult.x };
    } else {
      salida.push({ ...it });
    }
  }
  return salida.map((i) => ({ ...i, s: i.s.replace(/\s+/g, ' ').trim() }));
}

/** Agrupa por `y` (de arriba abajo) y ordena cada fila por `x`. */
export function agruparFilas(items: readonly ItemTexto[], tol = TOL_FILA): Fila[] {
  const orden = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const filas: Fila[] = [];
  for (const it of orden) {
    const f = filas[filas.length - 1];
    if (f && Math.abs(f.y - it.y) <= tol) f.items.push(it);
    else filas.push({ y: it.y, items: [it] });
  }
  for (const f of filas) f.items.sort((a, b) => a.x - b.x);
  return filas;
}

export function textoFila(f: Fila): string {
  return f.items.map((i) => i.s.trim()).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * ¿Pueden ser el mismo texto una vez truncado por el ancho de columna?
 * El más corto debe ser prefijo del más largo; `?` (carácter perdido) casa con
 * cualquiera. Con menos de 3 caracteres no hay base para afirmarlo.
 */
export function compatibles(a: string, b: string, minimo = 3): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  const n = Math.min(x.length, y.length);
  if (n < minimo) return false;
  for (let i = 0; i < n; i += 1) {
    if (x[i] !== y[i] && x[i] !== '?' && y[i] !== '?') return false;
  }
  return true;
}

export function mediana(valores: readonly number[]): number {
  const v = [...valores].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Agrupa valores cercanos; devuelve los centros ordenados con su recuento. */
export function agruparValores(valores: readonly number[], tol: number): { centro: number; n: number }[] {
  const v = [...valores].sort((a, b) => a - b);
  const grupos: number[][] = [];
  for (const x of v) {
    const g = grupos[grupos.length - 1];
    if (g && x - g[g.length - 1] <= tol) g.push(x);
    else grupos.push([x]);
  }
  return grupos.map((g) => ({ centro: mediana(g), n: g.length }));
}

export const redondear = (n: number): number => Math.round(n * 10) / 10;
