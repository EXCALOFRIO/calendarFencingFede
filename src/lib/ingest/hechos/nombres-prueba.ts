/**
 * Comparación de nombres DENTRO de una misma prueba (puestos frente a asaltos, o dos lecturas
 * del mismo evento). La comparten la unión de copias del lote manual (`dedupe-pruebas.ts`) y la
 * ingesta automática. No sirve para unir personas entre pruebas: eso lo decide `nombres-union`.
 */
import { palabrasNombre } from '@/lib/nombres';

export type NombrePreparado = { palabras: string[]; norm: string };

export function prepararNombre(nombre: string): NombrePreparado {
  const palabras = palabrasNombre(nombre);
  return { palabras, norm: [...palabras].sort().join(' ') };
}

/**
 * `corto` cabe en `largo`: cada palabra suya es una palabra distinta de `largo`, salvo
 * la última (en el orden publicado), que puede ser el principio de una. Así se leen
 * los nombres que el PDF corta al ancho de la columna («ZABALA GUTIERRE»,
 * «DIAZ ESCALONA M», «BRAVO FERNAND»). Exige dos palabras, 4 letras en palabras
 * completas y 7 en total.
 */
export function cabe(corto: readonly string[], largo: readonly string[]): boolean {
  if (corto.length < 2 || corto.length > largo.length) return false;
  const libres = [...largo];
  let completas = 0;
  let total = 0;
  for (let i = 0; i < corto.length; i += 1) {
    const w = corto[i];
    const ultima = i === corto.length - 1;
    let j = libres.indexOf(w);
    if (j < 0 && ultima) j = libres.findIndex((l) => l.startsWith(w));
    if (j < 0) return false;
    if (libres[j] === w) completas += w.length;
    total += w.length;
    libres.splice(j, 1);
  }
  return completas >= 4 && total >= 7;
}

export function nombresCompatiblesRecorte(a: NombrePreparado, b: NombrePreparado): boolean {
  if (a.norm === b.norm) return a.norm !== '';
  return cabe(a.palabras, b.palabras) || cabe(b.palabras, a.palabras);
}

/** Índice de `candidatos` que casa con `nombre`: el exacto si hay uno solo, si no el único compatible. */
export function casarUnico(nombre: NombrePreparado, candidatos: readonly NombrePreparado[]): number | null {
  const exactos = candidatos.flatMap((c, i) => (c.norm === nombre.norm ? [i] : []));
  if (exactos.length === 1) return exactos[0];
  if (exactos.length > 1) return null;
  const compatibles = candidatos.flatMap((c, i) => (nombresCompatiblesRecorte(nombre, c) ? [i] : []));
  return compatibles.length === 1 ? compatibles[0] : null;
}

/** Nombres de `a` compatibles con alguno de `b`. */
export function nombresEnComun(a: readonly NombrePreparado[], b: readonly NombrePreparado[]): number {
  const exactos = new Set(b.map((n) => n.norm));
  let comunes = 0;
  for (const n of a) {
    if (exactos.has(n.norm) || b.some((m) => nombresCompatiblesRecorte(n, m))) comunes += 1;
  }
  return comunes;
}
