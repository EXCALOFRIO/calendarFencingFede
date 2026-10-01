import {
  candidatoDeEngarde,
  cotejar,
  planificarComplemento,
  type CandidatoComplementario,
  type LecturaComplementaria,
  type MotivoCotejo,
  type PlanComplementario,
  type PruebaCanonica,
  type ResultadosPrimarios,
} from './conciliar-complementario';
import {
  leerClasificacionEngarde,
  puestosDeEngarde,
  type DepsEngarde,
  type LecturaClasificacionEngarde,
  type LecturaTorneoEngarde,
  type PruebaEngarde,
} from './sources/engarde';

export type CanonicaConPrimarios = {
  competitionId: string;
  prueba: PruebaCanonica;
  primarios: ResultadosPrimarios;
};

export type ResultadoPruebaEngarde = {
  prueba: PruebaEngarde;
  candidato: CandidatoComplementario;
  /** `null` si ninguna prueba canónica coincide con certeza. */
  canonica: CanonicaConPrimarios | null;
  lectura: LecturaClasificacionEngarde | null;
  plan: PlanComplementario | { accion: 'sin_canonica'; motivos: MotivoCotejo[] };
};

/**
 * Concilia cada prueba de un torneo Engarde con las pruebas canónicas ya
 * guardadas. Sólo se lee la clasificación de una prueba que tiene UNA canónica
 * compatible: dos compatibles son ambiguas y no se elige ninguna; sin
 * canónica no se importa nada (una prueba de Engarde sola no crea ediciones).
 */
export async function conciliarTorneoEngarde(
  torneo: LecturaTorneoEngarde,
  canonicas: readonly CanonicaConPrimarios[],
  deps: DepsEngarde,
): Promise<ResultadoPruebaEngarde[]> {
  const salida: ResultadoPruebaEngarde[] = [];
  for (const prueba of torneo.pruebas) {
    const candidato = candidatoDeEngarde(prueba, { nombreTorneo: torneo.nombre });
    const cotejos = canonicas.map((c) => ({ c, cotejo: cotejar(c.prueba, candidato) }));
    const aceptadas = cotejos.filter((x) => x.cotejo.decision === 'aceptado');
    const dudosas = cotejos.filter((x) => x.cotejo.decision === 'revision');

    if (aceptadas.length !== 1) {
      const motivos: MotivoCotejo[] =
        aceptadas.length > 1
          ? ['canonica_ambigua']
          : [...new Set((dudosas.length > 0 ? dudosas : cotejos).flatMap((x) => x.cotejo.motivos))];
      salida.push({
        prueba,
        candidato,
        canonica: null,
        lectura: null,
        plan:
          aceptadas.length > 1 || dudosas.length > 0
            ? { accion: 'revision', motivos }
            : { accion: 'sin_canonica', motivos },
      });
      continue;
    }

    const canonica = aceptadas[0].c;
    const lectura = await leerClasificacionEngarde(prueba, deps);
    const candidatoLeido = candidatoDeEngarde(prueba, { nombreTorneo: torneo.nombre, pagina: lectura.pagina });
    const lecturaPlan: LecturaComplementaria = {
      estado: lectura.estado,
      puestos: lectura.pagina ? puestosDeEngarde(lectura.pagina) : [],
      motivo: lectura.motivo,
    };
    salida.push({
      prueba,
      candidato: candidatoLeido,
      canonica,
      lectura,
      plan: planificarComplemento({
        prueba: canonica.prueba,
        candidato: candidatoLeido,
        lectura: lecturaPlan,
        primarios: canonica.primarios,
      }),
    });
  }
  return salida;
}
