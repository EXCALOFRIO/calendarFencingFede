import type { PlaceType } from '@/lib/callups/tipos';
import { SEPARADOR } from '@/lib/sport/rotulos';

/**
 * Las etiquetas de convocatoria, partidas para poder ponerles rótulo.
 *
 * `competitionLabel` de `lib/callups/tipos.ts` devuelve la cadena entera de
 * `rotuloPrueba` («Espada femenina · Absoluto», «Espada femenina M17 ·
 * Equipos»), que es lo correcto para un asunto de correo, un `title` o una
 * línea de tabla. En la tarjeta cada dato va en su fila con su rótulo, así que
 * se parte aquí: un código de categoría («M17») va pegado al arma en la
 * cadena y se separa también.
 */
export function partirPrueba(
  etiqueta: string | null,
): { prueba: string; categoria: string | null } | null {
  if (!etiqueta) return null;
  const trozos = etiqueta.split(SEPARADOR).map((t) => t.trim());
  let prueba = trozos[0] ?? etiqueta;
  const resto = trozos.slice(1).filter(Boolean);
  const codigo = /\s([A-Z0-9+-]*\d[A-Z0-9+-]*)$/.exec(prueba);
  if (codigo) {
    prueba = prueba.slice(0, codigo.index);
    resto.unshift(codigo[1]);
  }
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
