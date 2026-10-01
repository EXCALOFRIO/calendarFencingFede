/**
 * Presupuesto HTTP compartido de un lote: peticiones y tiempo.
 *
 * Los límites del orquestador sólo se miran entre tareas, y una tarea (un
 * torneo, una prueba FIE paginada) hace decenas de peticiones. Por eso el
 * presupuesto se consulta en cada punto de entrada de red de los lectores
 * (fetch JSON/HTML, Engarde get/post, descarga de PDF, índices) y en cada
 * espera o reintento: reserva ANTES del intento y lanza si no queda margen.
 */

export type MotivoPresupuesto = 'limite_peticiones' | 'limite_tiempo';

export class ErrorPresupuestoAgotado extends Error {
  constructor(readonly motivo: MotivoPresupuesto) {
    super(`Presupuesto del lote agotado (${motivo}): no se hace la petición`);
    this.name = 'ErrorPresupuestoAgotado';
  }
}

export const esPresupuestoAgotado = (e: unknown): boolean =>
  e instanceof ErrorPresupuestoAgotado || (e instanceof Error && /Presupuesto del lote agotado/.test(e.message));

export const motivoDePresupuesto = (texto: string | null | undefined): MotivoPresupuesto | null => {
  const m = texto?.match(/Presupuesto del lote agotado \((limite_peticiones|limite_tiempo)\)/);
  return m ? (m[1] as MotivoPresupuesto) : null;
};

export type OpcionesPresupuesto = {
  maxPeticiones: number;
  maxMs: number;
  /** Reloj en ms; el mismo que usa el orquestador. */
  ahora: () => number;
};

export class PresupuestoHttp {
  private usadasN = 0;
  private readonly desde: number;
  private agotado: MotivoPresupuesto | null = null;

  constructor(private readonly o: OpcionesPresupuesto) {
    this.desde = o.ahora();
  }

  get usadas(): number {
    return this.usadasN;
  }

  get restantes(): number {
    return Math.max(0, this.o.maxPeticiones - this.usadasN);
  }

  /** Motivo por el que ya no cabe otra petición, o `null`. Una vez agotado, se recuerda. */
  motivoAgotado(): MotivoPresupuesto | null {
    if (this.agotado) return this.agotado;
    if (this.usadasN >= this.o.maxPeticiones) return 'limite_peticiones';
    if (this.o.ahora() - this.desde >= this.o.maxMs) return 'limite_tiempo';
    return null;
  }

  /** Motivo con el que el presupuesto negó de verdad una petición o espera. */
  get negado(): MotivoPresupuesto | null {
    return this.agotado;
  }

  /** Reserva una petición real antes de hacerla. */
  reservar(): void {
    const motivo = this.motivoAgotado();
    if (motivo) {
      this.agotado = motivo;
      throw new ErrorPresupuestoAgotado(motivo);
    }
    this.usadasN += 1;
  }

  /** ¿Cabe esperar `ms` y aún hacer algo después? */
  puedeEsperar(ms: number): boolean {
    return this.motivoAgotado() === null && this.o.ahora() - this.desde + Math.max(0, ms) < this.o.maxMs;
  }

  async esperar(ms: number, dormir: (ms: number) => Promise<void>): Promise<void> {
    if (!this.puedeEsperar(ms)) {
      const motivo = this.motivoAgotado() ?? 'limite_tiempo';
      this.agotado = motivo;
      throw new ErrorPresupuestoAgotado(motivo);
    }
    await dormir(ms);
  }
}

/** Envuelve una función de red: cada llamada reserva una petición antes de salir. */
export function conPresupuesto<A extends unknown[], R>(
  presupuesto: PresupuestoHttp,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args) => {
    presupuesto.reservar();
    return fn(...args);
  };
}
