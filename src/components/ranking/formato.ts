import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL } from '@/lib/utils';

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

/** "Espada femenino M17" */
export function etiquetaGrupo(g: ClaveGrupo): string {
  const arma = WEAPON_LABEL[g.weapon as keyof typeof WEAPON_LABEL] ?? g.weapon;
  const genero = GENDER_LABEL[g.gender as keyof typeof GENDER_LABEL] ?? g.gender;
  const cat = CATEGORY_LABEL[g.category as keyof typeof CATEGORY_LABEL] ?? g.category;
  // Sin punto medio: la etiqueta se lee entera como el nombre de un grupo,
  // no como tres datos encadenados.
  return `${arma} ${genero.toLowerCase()} ${cat}`;
}
