import { rotuloPrueba } from '@/lib/sport/rotulos';

/**
 * Formato de las cifras del ranking.
 *
 * Vive aparte de `src/lib/queries/ranking.ts` porque de allí tiran componentes
 * de cliente y ese fichero abre la conexión a la base de datos: importar un
 * valor (no un tipo) desde allí arrastraría el módulo de Neon al navegador.
 * Es la misma separación que ya hace `src/lib/callups/tipos.ts`.
 */

/** Puntos: dos decimales como mucho, y ninguno si es redondo. */
export function puntos(valor: number): string {
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 2,
  }).format(valor);
}

/** Coeficiente: siempre con dos decimales, que es como se publica. */
export function coeficiente(valor: number): string {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}

export type ClaveGrupo = { weapon: string; gender: string; category: string };

/** Misma clave que usa `groupKey()` en el servidor. */
export function clave(g: ClaveGrupo): string {
  return `${g.weapon}|${g.gender}|${g.category}`;
}

/**
 * El grupo con datos más parecido al pedido: el mismo, o misma arma y género,
 * o misma arma. `null` si no hay ninguno parecido (quien llama decide si cae
 * al primero). Lo usan el servidor, para saber qué grupo mandar, y la tabla,
 * para saber cuál enseñar: tienen que dar lo mismo.
 */
export function grupoMasParecido<G extends ClaveGrupo>(grupos: readonly G[], deseado: ClaveGrupo): G | null {
  return grupos.find((g) => clave(g) === clave(deseado))
    ?? grupos.find((g) => g.weapon === deseado.weapon && g.gender === deseado.gender)
    ?? grupos.find((g) => g.weapon === deseado.weapon)
    ?? null;
}

/** «Espada femenina M17», «Florete masculino» (ABS no se escribe). */
export function etiquetaGrupo(g: ClaveGrupo): string {
  return rotuloPrueba({ arma: g.weapon, genero: g.gender, categoria: g.category });
}
