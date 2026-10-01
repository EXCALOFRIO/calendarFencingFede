import type { AsaltoPdf, ExclusionesPdf } from './tipos';

export function exclusionesVacias(): ExclusionesPdf {
  return { equipo: 0, bye: 0, sinMarcador: 0, sinGanador: 0, incoherente: 0, identidadNoConfirmada: 0, conflicto: 0, duplicado: 0 };
}

export type DatosAsalto = Omit<AsaltoPdf, 'refA' | 'refB' | 'nombreA' | 'nombreB' | 'puntosA' | 'puntosB'> & {
  ganador: { ref: string; nombre: string; puntos: number };
  perdedor: { ref: string; nombre: string; puntos: number };
};

/** Orden canónico `refA < refB`, con el marcador orientado a cada uno. */
export function orientarAsalto(d: DatosAsalto): AsaltoPdf {
  const { ganador, perdedor, ...resto } = d;
  const [a, b] = ganador.ref < perdedor.ref ? [ganador, perdedor] : [perdedor, ganador];
  return { ...resto, refA: a.ref, refB: b.ref, nombreA: a.nombre, nombreB: b.nombre, puntosA: a.puntos, puntosB: b.puntos };
}

/**
 * Guarda un asalto una sola vez. El mismo cruce leído dos veces (un cuadro
 * grande repite cada ronda en dos páginas) cuenta como duplicado si coincide;
 * si el marcador difiere, ninguna de las dos lecturas es fiable y se retira.
 */
export class AcumuladorAsaltos {
  private readonly porClave = new Map<string, AsaltoPdf>();
  private readonly enConflicto = new Set<string>();

  constructor(private readonly excluidos: ExclusionesPdf) {}

  agregar(d: DatosAsalto): void {
    const a = orientarAsalto(d);
    const clave = `${a.fase}|${a.ronda}|${a.refA}|${a.refB}`;
    if (this.enConflicto.has(clave)) {
      this.excluidos.conflicto += 1;
      return;
    }
    const previo = this.porClave.get(clave);
    if (!previo) {
      this.porClave.set(clave, a);
      return;
    }
    if (previo.puntosA === a.puntosA && previo.puntosB === a.puntosB) {
      this.excluidos.duplicado += 1;
      return;
    }
    this.porClave.delete(clave);
    this.enConflicto.add(clave);
    this.excluidos.conflicto += 2;
  }

  get asaltos(): AsaltoPdf[] {
    return [...this.porClave.values()];
  }
}
