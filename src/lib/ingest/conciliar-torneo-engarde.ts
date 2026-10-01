import {
  candidatoDeEngarde,
  cotejar,
  planificarAsaltos,
  planificarComplemento,
  type CandidatoComplementario,
  type EstadoAsaltosPrimarios,
  type LecturaAsaltosComplementaria,
  type LecturaComplementaria,
  type MotivoCotejo,
  type PlanAsaltos,
  type PlanComplementario,
  type PruebaCanonica,
  type ResultadosPrimarios,
} from './conciliar-complementario';
import { leerCuadroEngarde, urlsCuadroDePrueba, type LecturaCuadroEngarde } from './sources/engarde-cuadro';
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
  /** Lo que la primaria sabe de poules y cuadro por separado; ausente = desconocido. */
  primariosAsaltos?: { poules: EstadoAsaltosPrimarios; cuadro: EstadoAsaltosPrimarios };
};

export type ResultadoPruebaEngarde = {
  prueba: PruebaEngarde;
  candidato: CandidatoComplementario;
  /** `null` si ninguna prueba canónica coincide con certeza. */
  canonica: CanonicaConPrimarios | null;
  lectura: LecturaClasificacionEngarde | null;
  plan: PlanComplementario | { accion: 'sin_canonica'; motivos: MotivoCotejo[] };
  /** Asaltos del cuadro individual; sólo con una canónica aceptada y prueba individual. */
  cuadro?: { plan: PlanAsaltos; lectura: LecturaCuadroEngarde | null };
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
    const plan = planificarComplemento({
      prueba: canonica.prueba,
      candidato: candidatoLeido,
      lectura: lecturaPlan,
      primarios: canonica.primarios,
    });
    const resultado: ResultadoPruebaEngarde = { prueba, candidato: candidatoLeido, canonica, lectura, plan };
    if (prueba.individual === true && canonica.prueba.formato === 'INDIVIDUAL' && plan.accion !== 'rechazar') {
      resultado.cuadro = await conciliarCuadro(prueba, torneo.nombre, canonica, candidatoLeido, lectura, deps);
    }
    salida.push(resultado);
  }
  return salida;
}

const SIN_LECTURA_CUADRO: LecturaAsaltosComplementaria = { estado: 'completo', asaltos: [], publicado: 0, motivo: null };

/**
 * El cuadro se lee sólo si la primaria sabe que NO lo publica: con cualquier
 * otro estado el plan se difiere o no cambia sin pedir la página. Las
 * páginas leídas son únicamente las que la propia prueba ofrece, y su fecha
 * sustituye a la del índice para cotejar que ese documento es de esa edición.
 */
async function conciliarCuadro(
  prueba: PruebaEngarde,
  nombreTorneo: string | null,
  canonica: CanonicaConPrimarios,
  candidatoLeido: CandidatoComplementario,
  clasificacion: LecturaClasificacionEngarde,
  deps: DepsEngarde,
): Promise<{ plan: PlanAsaltos; lectura: LecturaCuadroEngarde | null }> {
  const primario = canonica.primariosAsaltos?.cuadro ?? 'desconocido';
  if (primario !== 'no_publicado' && primario !== 'sin_resultados') {
    return {
      lectura: null,
      plan: planificarAsaltos({
        prueba: canonica.prueba,
        candidato: candidatoLeido,
        fase: 'TABLEAU',
        lectura: SIN_LECTURA_CUADRO,
        primario,
      }),
    };
  }
  const lectura = await leerCuadroEngarde(prueba, urlsCuadroDePrueba(prueba, clasificacion.pagina), deps);
  const candidato = candidatoDeEngarde(prueba, { nombreTorneo, pagina: clasificacion.pagina });
  const delCuadro: CandidatoComplementario = {
    ...candidato,
    fecha: lectura.pagina?.fecha ?? candidato.fecha,
  };
  const lecturaPlan: LecturaAsaltosComplementaria = {
    estado: lectura.estado,
    asaltos: lectura.parte?.asaltos ?? [],
    publicado: lectura.parte?.publicado ?? 0,
    motivo: lectura.motivo,
  };
  return {
    lectura,
    plan: planificarAsaltos({
      prueba: canonica.prueba,
      candidato: delCuadro,
      fase: 'TABLEAU',
      lectura: lecturaPlan,
      primario,
    }),
  };
}
