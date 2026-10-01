import {
  candidatoDeFww,
  planificarAsaltos,
  type CandidatoComplementario,
  type LecturaAsaltosComplementaria,
  type PlanAsaltos,
} from './conciliar-complementario';
import type { CanonicaConPrimarios } from './conciliar-torneo-engarde';
import { parsearUrlFww } from './sources/fww';
import { agregarLecturasFww, leerDestinoFww, type LecturaAsaltosFww } from './sources/fww-asaltos';
import type { DepsEngarde } from './sources/engarde';

export type ResultadoFaseFww = {
  plan: PlanAsaltos;
  lectura: LecturaAsaltosFww;
  /** Candidato con el contexto de la primera página leída; `null` si ninguna se leyó. */
  candidato: CandidatoComplementario | null;
};

/**
 * Concilia los destinos FWW EXACTOS que ofrece una prueba (`pools/N` para las
 * poules, `direct/N` para el cuadro) con su canónica. Cada fase se compara con
 * su propio estado primario; el contexto (edición, sede, fecha, arma, género,
 * categoría y modalidad) sale de la página realmente leída, no de la URL.
 */
export async function conciliarAsaltosFww(
  entrada: {
    canonica: CanonicaConPrimarios;
    urls: { poules: readonly string[]; cuadro: readonly string[] };
  },
  deps: Pick<DepsEngarde, 'get'>,
): Promise<{ poules: ResultadoFaseFww; cuadro: ResultadoFaseFww }> {
  const fase = async (
    nombre: 'POULE' | 'TABLEAU',
    urls: readonly string[],
    primario: 'poules' | 'cuadro',
  ): Promise<ResultadoFaseFww> => {
    const lecturas = [];
    for (const url of urls) {
      const u = parsearUrlFww(url);
      const esperado = nombre === 'POULE' ? 'pools' : 'direct';
      // Sólo se leen destinos del tipo de la fase: un results/ no acredita poules ni cuadro.
      if (!u || u.seccion !== esperado) continue;
      lecturas.push(await leerDestinoFww(url, deps));
    }
    const lectura = agregarLecturasFww(nombre, lecturas);
    const primeraPagina = lecturas.find((l) => l.estado === 'ok' && l.pagina);
    const lecturaPlan: LecturaAsaltosComplementaria = {
      estado: lectura.estado,
      asaltos: lectura.parte?.asaltos ?? [],
      publicado: lectura.parte?.publicado ?? 0,
      motivo: lectura.motivo,
    };
    if (!primeraPagina?.pagina) {
      // Sin documento leído no hay contexto que cotejar: sólo queda constancia de que no se pudo leer.
      const estado = lectura.estado === 'error' ? 'error' : 'no_publicado';
      return { lectura, candidato: null, plan: { accion: 'sin_hechos', estado, motivo: lectura.motivo } };
    }
    const ref = parsearUrlFww(primeraPagina.url)!;
    const candidato = candidatoDeFww(primeraPagina.url, `${ref.id}-${ref.temporada}`, primeraPagina.pagina);
    const estadoPrimario = entrada.canonica.primariosAsaltos?.[primario] ?? 'desconocido';
    return {
      lectura,
      candidato,
      plan: planificarAsaltos({
        prueba: entrada.canonica.prueba,
        candidato,
        fase: nombre,
        lectura: lecturaPlan,
        primario: estadoPrimario,
      }),
    };
  };
  return {
    poules: await fase('POULE', entrada.urls.poules, 'poules'),
    cuadro: await fase('TABLEAU', entrada.urls.cuadro, 'cuadro'),
  };
}
