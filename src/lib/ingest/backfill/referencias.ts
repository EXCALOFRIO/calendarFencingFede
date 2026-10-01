/**
 * Reescritura única de listas de inscritos FIE tras la migración 0018.
 *
 * `huellaDeInscritos` incluye si la tabla de referencias existe, así que al
 * aplicar 0018 la huella de cada lista cambia aunque sus inscritos no: cada
 * lista elegible se reescribe UNA vez para guardar sus IDs. Aquí se distingue
 * esa reescritura forzada de un cambio real de contenido, se acota por
 * ejecución y se cuenta aparte. No hidrata nada por su cuenta: las listas de
 * pruebas ya disputadas no vuelven a entrar en la ventana de lectura y siguen
 * sin referencias hasta que alguien las relea de forma explícita.
 */

import type { DecisionCapacidad } from './capacidad';
import type { GuardaCapacidad } from './guarda-capacidad';

/** Tope por ejecución de reescrituras forzadas; las demás quedan para la siguiente lectura elegible. */
export const MAX_REESCRITURAS_POR_REFERENCIAS = 60;

export type ClaseHuella =
  | 'sin_huella'
  | 'sin_cambios'
  | 'reescritura_por_referencias'
  | 'contenido_cambiado';

export function clasificarHuellaInscritos(entrada: {
  guardada: string | null;
  sinRef: string;
  conRef: string;
  conReferencias: boolean;
}): ClaseHuella {
  const { guardada, sinRef, conRef, conReferencias } = entrada;
  if (guardada === null) return 'sin_huella';
  if (!conReferencias) return guardada === sinRef ? 'sin_cambios' : 'contenido_cambiado';
  if (guardada === conRef) return 'sin_cambios';
  return guardada === sinRef ? 'reescritura_por_referencias' : 'contenido_cambiado';
}

export function repartirReescrituras<T extends { clase: ClaseHuella }>(
  leidas: readonly T[],
  limite: number,
): { escribir: T[]; diferidas: T[]; reescritas: number } {
  const escribir: T[] = [];
  const diferidas: T[] = [];
  let reescritas = 0;
  for (const l of leidas) {
    if (l.clase !== 'reescritura_por_referencias') {
      escribir.push(l);
    } else if (reescritas < limite) {
      escribir.push(l);
      reescritas += 1;
    } else {
      diferidas.push(l);
    }
  }
  return { escribir, diferidas, reescritas };
}

/**
 * Igual que `repartirReescrituras`, pero la reescritura forzada sólo se
 * escribe si la guarda de capacidad autoriza el tamaño REAL de las listas ya
 * leídas. Si no autoriza (o no puede medir), ninguna se escribe: pasan a
 * diferidas, sin tocar su huella ni su marca de lectura, así que no parecen
 * hidratadas y vuelven a ser elegibles. Las listas con contenido nuevo no se
 * retienen: no son una reescritura opcional.
 */
export async function repartirReescriturasConGuarda<T extends { clase: ClaseHuella; inscritos: readonly unknown[] }>(
  leidas: readonly T[],
  limite: number,
  guarda?: GuardaCapacidad,
): Promise<{ escribir: T[]; diferidas: T[]; reescritas: number; capacidad: DecisionCapacidad | null }> {
  const base = repartirReescrituras(leidas, limite);
  if (!guarda || base.reescritas === 0) return { ...base, capacidad: null };
  const forzadas = base.escribir.filter((l) => l.clase === 'reescritura_por_referencias');
  const decision = await guarda({
    puestos: forzadas.reduce((s, l) => s + l.inscritos.length, 0),
    asaltos: 0,
    documentos: 0,
    unidades: forzadas.length,
  });
  if (decision.continuar) return { ...base, capacidad: decision };
  return {
    escribir: base.escribir.filter((l) => l.clase !== 'reescritura_por_referencias'),
    diferidas: [...base.diferidas, ...forzadas],
    reescritas: 0,
    capacidad: decision,
  };
}