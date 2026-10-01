import { conciliarAsaltosFww } from '../conciliar-asaltos-fww';
import { candidatoDeFww, planificarComplemento } from '../conciliar-complementario';
import { conciliarTorneoEngarde, type CanonicaConPrimarios } from '../conciliar-torneo-engarde';
import {
  persistirAsaltosComplemento,
  persistirComplemento,
  type DepsAsaltosComplemento,
  type DepsComplemento,
} from '../complementarios-persist';
import { clasificarSerie } from '../series-complementarias';
import { leerTorneoEngarde, type DepsEngarde, type LecturaTorneoEngarde } from '../sources/engarde';
import { leerResultadosFww, parsearUrlFww, puestosDeFww } from '../sources/fww';
import { clasificarFalloTecnico, type ResultadoTarea } from './orquestador';

/**
 * Pasos acotados de las fuentes complementarias (Engarde y Fencing Worldwide)
 * para el backfill. Dependen de que la prueba canónica y la cobertura primaria
 * ya estén cargadas: el orquestador planifica las primarias antes, y aquí una
 * prueba sin canónica compatible no escribe nada ni se convierte en
 * `sin_resultados` para forzar una importación.
 *
 * Los layouts de poules de Engarde no soportados siguen siendo `parcial` o
 * revisión explícita; no se amplía el parser. Un fallo técnico (429, 5xx, red)
 * se devuelve como error reintentable, no como vacío.
 */

export type DepsComplementosJob = {
  engarde: DepsEngarde;
  persistencia: DepsComplemento & DepsAsaltosComplemento;
  cargarCanonicas: (rango: { desde: string; hasta: string }) => Promise<CanonicaConPrimarios[]>;
  leerTorneo?: (org: string, evt: string, deps: DepsEngarde) => Promise<LecturaTorneoEngarde>;
  conciliar?: typeof conciliarTorneoEngarde;
  leerResultadosFww?: typeof leerResultadosFww;
  conciliarAsaltosFww?: typeof conciliarAsaltosFww;
};

const MARGEN_DIAS = 31;

const sumarDias = (dia: string, dias: number): string =>
  new Date(Date.parse(`${dia}T00:00:00.000Z`) + dias * 86_400_000).toISOString().slice(0, 10);

function fallo(mensaje: string | null, peticiones: number): ResultadoTarea {
  const texto = mensaje ?? 'Fallo de lectura';
  const tecnico = clasificarFalloTecnico(new Error(texto));
  return { estado: 'error', peticiones, mensaje: texto, ...(tecnico ? { tecnico } : {}) };
}

export async function ejecutarEngardeTorneo(
  deps: DepsComplementosJob,
  org: string,
  evt: string,
): Promise<ResultadoTarea> {
  const leer = deps.leerTorneo ?? leerTorneoEngarde;
  const conciliar = deps.conciliar ?? conciliarTorneoEngarde;
  const torneo = await leer(org, evt, deps.engarde);
  let peticiones = 1;

  if (torneo.estado === 'error') return fallo(torneo.error, peticiones);
  if (torneo.pruebas.length === 0) {
    return { estado: 'sin_cambios', peticiones, mensaje: 'El índice declara 0 pruebas; no se infiere ninguna cobertura' };
  }

  const fechas = torneo.pruebas.map((p) => p.fecha).filter((f): f is string => f !== null).sort();
  if (fechas.length === 0) {
    return { estado: 'pendiente', peticiones, mensaje: 'Ninguna prueba publica fecha: no se puede cotejar con la canónica' };
  }
  const canonicas = await deps.cargarCanonicas({
    desde: sumarDias(fechas[0], -MARGEN_DIAS),
    hasta: sumarDias(fechas[fechas.length - 1], MARGEN_DIAS),
  });

  const resultados = await conciliar(torneo, canonicas, deps.engarde);
  const serie = clasificarSerie({ nombre: torneo.nombre });
  let puestos = 0;
  let asaltos = 0;
  let completas = 0;
  let sinCerrar = 0;
  let tecnico: ResultadoTarea | null = null;

  for (const r of resultados) {
    if (!r.canonica) {
      sinCerrar += 1;
      continue;
    }
    peticiones += 1 + (r.cuadro?.lectura ? 1 : 0);

    if (r.cuadro) {
      const c = await persistirAsaltosComplemento(deps.persistencia, {
        competitionId: r.canonica.competitionId,
        prueba: r.canonica.prueba,
        candidato: r.candidato,
        fase: 'TABLEAU',
        plan: r.cuadro.plan,
      });
      if (c.estado === 'esquema_no_aplicado') return { estado: 'esquema_no_aplicado', peticiones };
      asaltos += c.asaltos.nuevos + c.asaltos.revisados;
      if (r.cuadro.plan.accion === 'sin_hechos' && r.cuadro.plan.estado === 'error') {
        tecnico ??= fallo(r.cuadro.plan.motivo, peticiones);
      }
    }

    const p = await persistirComplemento(deps.persistencia, {
      competitionId: r.canonica.competitionId,
      prueba: r.canonica.prueba,
      candidato: r.candidato,
      plan: r.plan as Parameters<typeof persistirComplemento>[1]['plan'],
      publicado: r.lectura?.publicado ?? null,
    });
    if (p.estado === 'esquema_no_aplicado') return { estado: 'esquema_no_aplicado', peticiones };
    puestos += p.puestos.nuevos + p.puestos.revisados;
    if (r.plan.accion === 'sin_hechos' && r.plan.estado === 'error') tecnico ??= fallo(r.plan.motivo, peticiones);
    if (r.plan.accion === 'escribir' && r.plan.cobertura === 'completo') completas += 1;
    else if (r.plan.accion !== 'sin_cambios') sinCerrar += 1;
    else completas += 1;
  }

  const nota = `${resultados.length} pruebas, serie ${serie ?? 'sin determinar'}, ${sinCerrar} sin cerrar (sin canónica, diferidas, en revisión o parciales)`;
  if (tecnico?.tecnico) return { ...tecnico, peticiones, hechos: { puestos, asaltos } };
  return {
    estado: sinCerrar === 0 && completas === resultados.length ? 'completo' : 'parcial',
    peticiones,
    mensaje: nota,
    hechos: { puestos, asaltos },
  };
}

export type EntradaFww = {
  canonica: CanonicaConPrimarios;
  /** Página de clasificación (`results`) de la prueba, si se conoce. */
  resultadosUrl: string | null;
  /** Destinos exactos (`pools/N`, `direct/N`) que ofrece la prueba. */
  urls: { poules: readonly string[]; cuadro: readonly string[] };
};

export async function ejecutarFwwPrueba(deps: DepsComplementosJob, entrada: EntradaFww): Promise<ResultadoTarea> {
  const leerFinales = deps.leerResultadosFww ?? leerResultadosFww;
  const conciliarFases = deps.conciliarAsaltosFww ?? conciliarAsaltosFww;
  const { canonica } = entrada;
  let peticiones = 0;
  let puestos = 0;
  let asaltos = 0;
  let sinCerrar = 0;
  let tecnico: ResultadoTarea | null = null;

  if (entrada.resultadosUrl) {
    peticiones += 1;
    const lectura = await leerFinales(entrada.resultadosUrl, deps.engarde);
    if (lectura.estado === 'error') {
      tecnico ??= fallo(lectura.motivo, peticiones);
    } else if (lectura.pagina) {
      const ref = parsearUrlFww(lectura.url);
      const candidato = candidatoDeFww(lectura.url, ref ? `${ref.id}-${ref.temporada}` : lectura.url, lectura.pagina);
      const plan = planificarComplemento({
        prueba: canonica.prueba,
        candidato,
        lectura: { estado: lectura.estado, puestos: puestosDeFww(lectura.pagina), motivo: lectura.motivo },
        primarios: canonica.primarios,
      });
      const r = await persistirComplemento(deps.persistencia, {
        competitionId: canonica.competitionId,
        prueba: canonica.prueba,
        candidato,
        plan,
        publicado: lectura.publicado,
      });
      if (r.estado === 'esquema_no_aplicado') return { estado: 'esquema_no_aplicado', peticiones };
      puestos += r.puestos.nuevos + r.puestos.revisados;
      if (plan.accion !== 'escribir' || plan.cobertura !== 'completo') sinCerrar += 1;
    } else {
      // Sin página no hay contexto que cotejar: queda diferido, no se fabrica sin_resultados.
      sinCerrar += 1;
    }
  }

  if (entrada.urls.poules.length > 0 || entrada.urls.cuadro.length > 0) {
    peticiones += entrada.urls.poules.length + entrada.urls.cuadro.length;
    const fases = await conciliarFases({ canonica, urls: entrada.urls }, deps.engarde);
    for (const [fase, nombre] of [
      [fases.poules, 'POULE'],
      [fases.cuadro, 'TABLEAU'],
    ] as const) {
      if (fase.plan.accion === 'sin_hechos' && fase.plan.estado === 'error') {
        tecnico ??= fallo(fase.plan.motivo, peticiones);
      }
      // Sin documento leído no hay candidato con el que registrar cobertura.
      if (!fase.candidato) {
        sinCerrar += 1;
        continue;
      }
      const r = await persistirAsaltosComplemento(deps.persistencia, {
        competitionId: canonica.competitionId,
        prueba: canonica.prueba,
        candidato: fase.candidato,
        fase: nombre,
        plan: fase.plan,
      });
      if (r.estado === 'esquema_no_aplicado') return { estado: 'esquema_no_aplicado', peticiones };
      asaltos += r.asaltos.nuevos + r.asaltos.revisados;
      if (fase.plan.accion !== 'escribir' || fase.plan.cobertura !== 'completo') sinCerrar += 1;
    }
  }

  if (tecnico?.tecnico) return { ...tecnico, peticiones, hechos: { puestos, asaltos } };
  return { estado: sinCerrar === 0 ? 'completo' : 'parcial', peticiones, hechos: { puestos, asaltos } };
}
