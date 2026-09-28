import type { Weapon } from '@/lib/auth/session';

/**
 * ===========================================================================
 * EL FILTRO DE ARMA DE «SELECCIÓN»
 * ===========================================================================
 *
 * El fallo que arregla, dicho tal cual lo dejó avisado el agente del ámbito del
 * seleccionador: **`/convocatorias` no filtraba por arma**, así que el
 * seleccionador de florete entraba viendo «Selección Sub-23 de espada
 * femenina». La pantalla lo documentaba como decisión consciente, y es lo
 * contrario de lo que se pidió:
 *
 *   «que el seleccionador español pueda ver a sus tiradores y él pueda
 *    gestionar todo»
 *   «le saldrán las competiciones por defecto de chicos y chicas»
 *
 * Con qué armas arranca lo decide `armasDeArranque()` de `src/lib/ambito.ts`
 * —función pura, 23 casos probados— y **no se reescribe aquí**: el arranque es
 * suyo. Lo que vive en este fichero es la otra mitad, que allí no existe: dada
 * una convocatoria y unas armas marcadas, ¿se enseña?
 *
 * Es una **regla de visibilidad**, y esas se rompen en silencio: nadie ve un
 * error, simplemente un seleccionador empieza a ver de menos —o de más— y no se
 * entera hasta que se pierde una convocatoria. Por eso es pura y por eso tiene
 * pruebas (`tests/convocatorias.test.ts`).
 *
 * Y es un filtro, no un permiso: nadie tiene prohibido ver nada, igual que en
 * el calendario. El botón de quitar el filtro está al lado.
 */

/**
 * ¿Entra esta convocatoria con las armas marcadas?
 *
 * Tres casos y los tres importan:
 *
 *  1. **Sin filtro** (ninguna arma marcada, o las tres): entra todo. Es lo que
 *     ve la dirección técnica, que es su trabajo.
 *  2. **La convocatoria toca alguna de las marcadas**: entra. Basta con una: un
 *     campeonato de España convocado con las tres armas en el mismo documento
 *     le interesa entero al seleccionador de florete.
 *  3. **No se sabe de qué arma es** (lista vacía: nadie tiene prueba asignada
 *     todavía): entra. Esconder algo cuyo arma se desconoce sería el mismo
 *     fallo al revés, y además un borrador recién creado siempre está así.
 */
export function convocatoriaVisible(
  armasDeLaConvocatoria: Weapon[],
  armasMarcadas: Weapon[],
): boolean {
  if (armasMarcadas.length === 0) return true;
  if (armasMarcadas.length >= 3) return true;
  if (armasDeLaConvocatoria.length === 0) return true;
  return armasDeLaConvocatoria.some((a) => armasMarcadas.includes(a));
}

/**
 * Cuántas quedan fuera del filtro.
 *
 * Hace falta para poder escribir un estado vacío que no mienta: «ninguna
 * convocatoria de florete» a secas deja pensando si el panel está roto. Con el
 * número —«hay 2 de otras armas»— se entiende que el filtro está puesto y que
 * quitarlo las trae.
 */
export function ocultasPorArma<T extends { id: string }>(
  convocatorias: T[],
  armasPorConvocatoria: Record<string, Weapon[]>,
  armasMarcadas: Weapon[],
): number {
  return convocatorias.filter(
    (c) => !convocatoriaVisible(armasPorConvocatoria[c.id] ?? [], armasMarcadas),
  ).length;
}
