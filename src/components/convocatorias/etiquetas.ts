import type { PlaceType } from '@/lib/callups/tipos';

/**
 * Las etiquetas de convocatoria, partidas para poder ponerles rótulo.
 *
 * `competitionLabel` de `lib/callups/tipos.ts` devuelve la cadena entera
 * («Espada femenino · Absoluto»), que es lo correcto para un asunto de
 * correo o para un `title`. En pantalla no: ahí cada dato va en su fila con
 * su rótulo, y un punto medio entre dos palabras no dice cuál es el arma y
 * cuál la categoría. Se parte aquí en vez de cambiar la función porque la
 * cadena completa se sigue usando tal cual en los avisos.
 */
export function partirPrueba(
  etiqueta: string | null,
): { prueba: string; categoria: string | null } | null {
  if (!etiqueta) return null;
  const trozos = etiqueta.split(' · ').map((t) => t.trim());
  const prueba = trozos[0] ?? etiqueta;
  const resto = trozos.slice(1).filter(Boolean);
  return {
    prueba,
    categoria: resto.length > 0 ? resto.join(', ') : null,
  };
}

/**
 * El tipo de plaza sin la palabra «Plaza» delante, porque esa palabra ya es
 * el rótulo. «Plaza: Plaza por criterio técnico» se lee como un error.
 */
export const PLAZA_CORTA: Record<PlaceType, string> = {
  ranking: 'Por ranking',
  tecnica: 'Por criterio técnico',
};
