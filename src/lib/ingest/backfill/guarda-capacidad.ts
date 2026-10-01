import {
  evaluarCapacidad,
  proyectarCrecimiento,
  TASAS_CONSERVADORAS,
  type DecisionCapacidad,
  type EstimacionLote,
  type Ocupacion,
  type PlanNeon,
  type TasasCrecimiento,
} from './capacidad';

/**
 * Guarda de capacidad para el momento justo antes de escribir.
 *
 * La estimación del plan (150 puestos por prueba, 60 por lista...) es sólo un
 * supuesto para ordenar el lote. Lo que decide si se escribe es el tamaño del
 * lote ya LEÍDO: una prueba con 2400 puestos o un torneo entero pesan más que
 * lo estimado. La guarda mide la ocupación en ese instante y proyecta el
 * crecimiento de lo que va a escribirse. Si no puede medir, no autoriza.
 *
 * Es una proyección con tasas conservadoras, no un crecimiento medido.
 */
export type GuardaCapacidad = (lote: EstimacionLote) => Promise<DecisionCapacidad>;

export function crearGuardaCapacidad(entrada: {
  plan: PlanNeon;
  medir: () => Promise<Ocupacion>;
  tasas?: TasasCrecimiento;
}): GuardaCapacidad {
  return async (lote) => {
    let actual: number | null = null;
    try {
      actual = (await entrada.medir()).logicoBytes;
    } catch {
      actual = null;
    }
    return evaluarCapacidad({
      actualBytes: actual,
      proyectadoBytes: proyectarCrecimiento(entrada.tasas ?? TASAS_CONSERVADORAS, lote),
      plan: entrada.plan,
    });
  };
}
