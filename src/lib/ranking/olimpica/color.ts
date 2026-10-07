import type { AnotacionOlimpica } from './anotar';

/**
 * El color de la etiqueta olímpica, igual en /ranking, el perfil y Buscar.
 *
 *   clasificado                     → verde     plaza hoy por algún camino.
 *   cerca (con o sin puntos medibles,
 *          también ANFITRION)       → amarillo  le falta algo: puntos, puestos
 *                                               o la decisión de EE. UU.
 *   pendiente con `sinVeto`         → gris      RUS/BLR que entrarían o estarían
 *                                               cerca si contaran.
 *   pendiente sin `sinVeto`         → nada      RUS/BLR lejos de plaza y
 *                                               neutrales (nunca ocupan plaza).
 *   null (con o sin TORNEO_ZONAL)   → nada      sin plaza ni camino medible.
 *
 * Es el mismo criterio que deja pasar `ordenarSoloJjoo`, así que el recuento
 * del filtro «Solo JJOO» y las etiquetas visibles coinciden.
 */
export type ColorOlimpico = 'verde' | 'amarillo' | 'gris';

export function colorOlimpico(a: AnotacionOlimpica | null | undefined): ColorOlimpico | null {
  switch (a?.estado) {
    case 'clasificado':
      return 'verde';
    case 'cerca':
      return 'amarillo';
    case 'pendiente':
      return a.sinVeto ? 'gris' : null;
    default:
      return null;
  }
}

/** Entre varias marcas de una persona (una por arma), la que se enseña: verde, luego amarillo con menos que falte, luego gris. */
export function mejorMarcaOlimpica<T extends { anotacion: AnotacionOlimpica }>(marcas: readonly T[] | null | undefined): T | null {
  const peso = { verde: 0, amarillo: 1, gris: 2 } as const;
  let mejor: T | null = null;
  for (const m of marcas ?? []) {
    const c = colorOlimpico(m.anotacion);
    if (!c) continue;
    if (!mejor) { mejor = m; continue; }
    const cm = colorOlimpico(mejor.anotacion)!;
    const falta = (x: T) => x.anotacion.faltan ?? Number.POSITIVE_INFINITY;
    if (peso[c] < peso[cm] || (c === cm && c === 'amarillo' && falta(m) < falta(mejor))) mejor = m;
  }
  return mejor;
}
