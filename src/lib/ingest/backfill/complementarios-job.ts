import { conciliarAsaltosFww } from '../conciliar-asaltos-fww';
import { candidatoDeFww, planificarComplemento } from '../conciliar-complementario';
import { conciliarTorneoEngarde, type CanonicaConPrimarios } from '../conciliar-torneo-engarde';
import {
  persistirAsaltosComplemento,
  persistirComplemento,
  persistirEstadoCandidato,
  type DepsAsaltosComplemento,
  type DepsComplemento,
} from '../complementarios-persist';
import { clasificarSerie } from '../series-complementarias';
import { leerTorneoEngarde, type DepsEngarde, type LecturaTorneoEngarde } from '../sources/engarde';
import { leerResultadosFww, parsearUrlFww, puestosDeFww } from '../sources/fww';
import { clasificarFalloTecnico, type ResultadoTarea } from './orquestador';
import { motivoDePresupuesto } from './presupuesto-http';

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

type PlanCierre = { accion: string; cobertura?: string; estado?: string };

/**
 * Un hecho está «cerrado» si quedó escrito completo, ya era canónico o la fuente
 * publica explícitamente cero. Revisión, conflicto, aplazamiento, rechazo, lectura
 * parcial o fallida NO cierran: la unidad no puede salir completa por contar cero
 * pendientes.
 */
function cerrado(plan: PlanCierre): boolean {
  if (plan.accion === 'escribir') return plan.cobertura === 'completo';
  if (plan.accion === 'sin_cambios') return true;
  if (plan.accion === 'sin_hechos') return plan.estado === 'sin_resultados';
  return false;
}

/**
 * Acumula, para toda la unidad, cada lectura que falló o quedó a medias. Una
 * señal técnica (429, 5xx, red) en un hecho PARCIAL conserva lo válido ya
 * escrito y permite reintentar; un fallo no técnico (403...) deja la unidad en
 * error, nunca completa.
 */
class Fallos {
  private readonly lista: ResultadoTarea[] = [];

  anotar(mensaje: string | null, peticiones: number) {
    this.lista.push(fallo(mensaje, peticiones));
  }

  /** Un parcial sólo cuenta si su motivo trae una señal técnica. */
  anotarParcial(mensaje: string | null | undefined, peticiones: number) {
    if (mensaje && clasificarFalloTecnico(new Error(mensaje))) this.lista.push(fallo(mensaje, peticiones));
  }

  resultado(peticiones: number, hechos: { puestos: number; asaltos: number }): ResultadoTarea | null {
    const presupuesto = this.lista.find((f) => motivoDePresupuesto(f.mensaje));
    if (presupuesto) return { estado: 'pendiente', peticiones, mensaje: presupuesto.mensaje, hechos };
    const tecnico = this.lista.find((f) => f.tecnico);
    if (tecnico) return { ...tecnico, peticiones, hechos };
    if (this.lista.length > 0) return { ...this.lista[0], peticiones, hechos };
    return null;
  }
}

export async function ejecutarEngardeTorneo(
  deps: DepsComplementosJob,
  org: string,
  evt: string,
  /** Temporada de la unidad: sólo se usa para anotar candidatos sin canónica aceptada (en revisión). */
  season: string | null = null,
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
  let sinCerrar = 0;
  const fallos = new Fallos();
  // El índice del torneo pudo quedar parcial por una página 429/5xx: lo válido se conserva y la señal sube.
  if (torneo.estado === 'parcial') {
    fallos.anotarParcial(torneo.error, peticiones);
    sinCerrar += 1;
  }

  for (const r of resultados) {
    if (!r.canonica) {
      sinCerrar += 1;
      if (r.plan.accion === 'revision' && season) {
        const p = await persistirEstadoCandidato(deps.persistencia, {
          season,
          competitionId: null,
          candidato: r.candidato,
          factKind: 'results',
          plan: r.plan,
        });
        if (p.estado === 'esquema_no_aplicado') return { estado: 'esquema_no_aplicado', peticiones };
      }
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
        fallos.anotar(r.cuadro.plan.motivo, peticiones);
      }
      fallos.anotarParcial(r.cuadro.lectura?.estado === 'parcial' ? r.cuadro.lectura.motivo : null, peticiones);
      if (!cerrado(r.cuadro.plan)) sinCerrar += 1;
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
    if (r.plan.accion === 'sin_hechos' && r.plan.estado === 'error') fallos.anotar(r.plan.motivo, peticiones);
    if (!cerrado(r.plan)) sinCerrar += 1;
  }

  const nota = `${resultados.length} pruebas, serie ${serie ?? 'sin determinar'}, ${sinCerrar} sin cerrar (sin canónica, diferidas, en revisión, parciales o con error)`;
  const fallido = fallos.resultado(peticiones, { puestos, asaltos });
  if (fallido) return fallido;
  return {
    estado: sinCerrar === 0 ? 'completo' : 'parcial',
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
  const fallos = new Fallos();

  if (entrada.resultadosUrl) {
    peticiones += 1;
    const lectura = await leerFinales(entrada.resultadosUrl, deps.engarde);
    if (lectura.estado === 'error') {
      // Sin finales leídos nada queda cerrado, sea cual sea el motivo del fallo (429, 5xx o 403).
      fallos.anotar(lectura.motivo, peticiones);
      sinCerrar += 1;
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
      if (!cerrado(plan)) sinCerrar += 1;
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
        fallos.anotar(fase.plan.motivo, peticiones);
      }
      fallos.anotarParcial(fase.lectura.estado === 'parcial' ? fase.lectura.motivo : null, peticiones);
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
      if (!cerrado(fase.plan)) sinCerrar += 1;
    }
  }

  const fallido = fallos.resultado(peticiones, { puestos, asaltos });
  if (fallido) return fallido;
  return { estado: sinCerrar === 0 ? 'completo' : 'parcial', peticiones, hechos: { puestos, asaltos } };
}