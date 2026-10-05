import { DatabaseSync } from 'node:sqlite';

/**
 * D1 rechaza los SELECT compuestos de más de cinco términos («too many terms in
 * compound SELECT»), y SQLite local no. Toda consulta preparada en las pruebas
 * se comprueba aquí para que el fallo aparezca antes de producción.
 */
export const MAX_TERMINOS_D1 = 5;

export function maxTerminosCompuestos(texto: string): number {
  const limpio = texto.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');
  const pila = [1];
  let maximo = 1;
  for (const t of limpio.match(/\(|\)|\bUNION\s+ALL\b|\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/gi) ?? []) {
    if (t === '(') pila.push(1);
    else if (t === ')') pila.pop();
    else maximo = Math.max(maximo, ++pila[pila.length - 1]);
  }
  return maximo;
}

const prepararOriginal = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function (this: DatabaseSync, texto: string) {
  if (maxTerminosCompuestos(texto) > MAX_TERMINOS_D1) {
    throw new Error(`SELECT compuesto con más de ${MAX_TERMINOS_D1} términos (D1 lo rechaza): ${texto.slice(0, 160)}`);
  }
  return prepararOriginal.call(this, texto);
} as typeof prepararOriginal;
