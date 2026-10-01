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
