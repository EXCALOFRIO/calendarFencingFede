import {
  TASAS_CONSERVADORAS,
  diferenciaOcupacion,
  evaluarCapacidad,
  proyectarCrecimiento,
  type DecisionCapacidad,
  type DiferenciaOcupacion,
  type EstimacionLote,
  type Ocupacion,
  type PlanNeon,
  type TasasCrecimiento,
} from './capacidad';

/**
 * Orquestador de lotes del backfill histórico.
 *
 * Es deliberadamente pequeño: no sabe leer ninguna fuente. Recibe tareas ya
 * planificadas y una función `ejecutar` que cada adaptador implementa, y se
 * ocupa sólo de lo que tiene que ser igual para todos:
 *
 *  - una tarea por clave de ranking/unidad y de una en una, así que dentro de
 *    una ejecución la lectura, la comparación, la escritura y el checkpoint de
 *    una clave nunca se solapan con los de otra copia de esa clave. Entre
 *    procesos NO hay lock ni CAS: el límite operativo es un único importador
 *    por clave (ver docs/backfill-historico.md);
 *  - límites por ejecución de tareas, peticiones y tiempo, y la parada deja el
 *    resto como pendiente (no lo descarta);
 *  - reintento técnico (429, 5xx, red) con espera exponencial o `Retry-After`.
 *    Un fallo técnico agotado deja la tarea en `error`, nunca en vacío: el
 *    progreso ya persistido por el adaptador (cursor, cobertura) se conserva;
 *  - medición de ocupación antes de cada tarea y parada previa si el
 *    crecimiento proyectado no cabe en el margen. Medir no escribe.
 */

export type TipoTarea =
  | 'fie_prueba'
  | 'skermo_prueba'
  | 'pdf_documento'
  | 'engarde_torneo'
  | 'fww_prueba'
  | 'enlaces_fie';

export type MotivoTarea =
  | 'continuar'
  | 'reintento_error'
  | 'categorias_ampliadas'
  | 'nunca_leido'
  | 'cadencia_reciente'
  | 'releer';

/** Menor número = más urgente. Una clave repetida conserva el motivo más urgente. */
export const PRIORIDAD_MOTIVO: Record<MotivoTarea, number> = {
  continuar: 0,
  reintento_error: 1,
  categorias_ampliadas: 2,
  nunca_leido: 3,
  cadencia_reciente: 4,
  releer: 5,
};

export type Tarea = {
  /** `fuente|temporada|clave de la prueba o documento`; identifica la unidad de checkpoint. */
  clave: string;
  tipo: TipoTarea;
  fuente: string;
  season: string;
  competitionKey: string;
  motivo: MotivoTarea;
  /** Relectura explícita de una unidad ya completa (`--releer`). */
  releer: boolean;
  /**
   * Las fuentes primarias (FIE, Skermo, PDF) se leen y persisten antes que las
   * complementarias, que cotejan contra lo ya guardado. Ausente = primaria.
   */
  fase?: 'primaria' | 'complementaria';
  estimacion: EstimacionLote;
  /** Entrada propia del adaptador (URL, cursor, parámetros). No la interpreta el orquestador. */
  datos?: Record<string, unknown>;
};

export type EstadoResultadoTarea =
  | 'completo'
  | 'parcial'
  | 'sin_cambios'
  | 'sin_resultados'
  | 'pendiente'
  | 'conflicto'
  | 'error'
  | 'esquema_no_aplicado';

export type ResultadoTarea = {
  estado: EstadoResultadoTarea;
  peticiones: number;
  mensaje?: string;
  /** Presente cuando el fallo es técnico y reintentable (429, 5xx, red). */
  tecnico?: { status: number | null; retryAfterMs: number | null };
  hechos?: { puestos?: number; asaltos?: number; documentos?: number };
};

export class ErrorTecnico extends Error {
  constructor(
    mensaje: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(mensaje);
    this.name = 'ErrorTecnico';
  }
}

const PATRON_RED = /fetch failed|econnreset|etimedout|enotfound|econnrefused|timeout|aborted|network|socket/i;

/** `null` si el error NO es técnico: no se reintenta y se anota en la tarea. */
export function clasificarFalloTecnico(e: unknown): { status: number | null; retryAfterMs: number | null } | null {
  if (e instanceof ErrorTecnico) return { status: e.status, retryAfterMs: e.retryAfterMs };
  const texto = e instanceof Error ? e.message : String(e);
  const http = texto.match(/\bHTTP[ :]*(\d{3})\b/i);
  if (http) {
    const status = Number(http[1]);
    return status === 429 || status >= 500 ? { status, retryAfterMs: null } : null;
  }
  return PATRON_RED.test(texto) ? { status: null, retryAfterMs: null } : null;
}

export function esperaDeReintento(
  intento: number,
  retryAfterMs: number | null,
  l: { esperaBaseMs: number; esperaMaxMs: number },
): number {
  if (retryAfterMs !== null && retryAfterMs >= 0) return Math.min(retryAfterMs, l.esperaMaxMs);
  return Math.min(l.esperaBaseMs * 2 ** intento, l.esperaMaxMs);
}

export function planificarLote(tareas: readonly Tarea[]): { tareas: Tarea[]; duplicadas: string[] } {
  const porClave = new Map<string, Tarea>();
  const duplicadas = new Set<string>();
  for (const t of tareas) {
    const previa = porClave.get(t.clave);
    if (!previa) {
      porClave.set(t.clave, t);
      continue;
    }
    duplicadas.add(t.clave);
    if (PRIORIDAD_MOTIVO[t.motivo] < PRIORIDAD_MOTIVO[previa.motivo]) porClave.set(t.clave, t);
  }
  const unicas = [...porClave.values()];
  const fase = (t: Tarea) => (t.fase === 'complementaria' ? 1 : 0);
  // sort es estable: a igual fase y urgencia se conserva el orden de entrada.
  unicas.sort((a, b) => fase(a) - fase(b) || PRIORIDAD_MOTIVO[a.motivo] - PRIORIDAD_MOTIVO[b.motivo]);
  return { tareas: unicas, duplicadas: [...duplicadas] };
}

export type LimitesLote = {
  maxTareas: number;
  maxPeticiones: number;
  maxMs: number;
  maxReintentos: number;
  esperaBaseMs: number;
  esperaMaxMs: number;
};

export const LIMITES_POR_DEFECTO: LimitesLote = {
  maxTareas: 20,
  maxPeticiones: 200,
  maxMs: 4 * 60_000,
  maxReintentos: 2,
  esperaBaseMs: 1000,
  esperaMaxMs: 30_000,
};

const MAX_FALLOS_SEGUIDOS = 3;

export type EntradaLote = {
  tareas: readonly Tarea[];
  ejecutar: (tarea: Tarea) => Promise<ResultadoTarea>;
  limites: LimitesLote;
  /** `false` = simulación: se planifica y se evalúa la capacidad, sin ejecutar nada. */
  aplicar: boolean;
  ahora: () => number;
  dormir: (ms: number) => Promise<void>;
  capacidad?: { plan: PlanNeon; medir: () => Promise<Ocupacion>; tasas?: TasasCrecimiento };
  alTerminarTarea?: (tarea: Tarea, resultado: ResultadoTarea) => Promise<void>;
};

export type ParadaLote =
  | 'limite_tareas'
  | 'limite_peticiones'
  | 'limite_tiempo'
  | 'limite_remoto'
  | 'fallos_seguidos'
  | 'capacidad'
  | 'esquema_no_aplicado';

export type TareaEjecutada = { tarea: Tarea; resultado: ResultadoTarea; reintentos: number };

export type InformeCapacidad = {
  plan: PlanNeon;
  antes: Ocupacion | null;
  despues: Ocupacion | null;
  diferencia: DiferenciaOcupacion | null;
  decision: DecisionCapacidad;
};

export type InformeLote = {
  modo: 'simulacion' | 'aplicado';
  parada: ParadaLote | null;
  ejecutadas: TareaEjecutada[];
  /** Tareas no empezadas: siguen siendo trabajo por hacer, no se descartan. */
  pendientes: Tarea[];
  duplicadas: string[];
  peticiones: number;
  proyectadoBytes: number;
  porEstado: Partial<Record<EstadoResultadoTarea, number>>;
  capacidad: InformeCapacidad | null;
};

async function medirSeguro(medir: () => Promise<Ocupacion>): Promise<Ocupacion | null> {
  try {
    return await medir();
  } catch {
    return null;
  }
}

function resumenPendientes(pendientes: readonly Tarea[]): { unidades: number; temporadas: string[] } {
  return { unidades: pendientes.length, temporadas: [...new Set(pendientes.map((t) => t.season))].sort() };
}

export async function ejecutarLote(entrada: EntradaLote): Promise<InformeLote> {
  const { limites, capacidad } = entrada;
  const plan = planificarLote(entrada.tareas);
  const tasas = capacidad?.tasas ?? TASAS_CONSERVADORAS;
  const inicio = entrada.ahora();

  const informe: InformeLote = {
    modo: entrada.aplicar ? 'aplicado' : 'simulacion',
    parada: null,
    ejecutadas: [],
    pendientes: [...plan.tareas],
    duplicadas: plan.duplicadas,
    peticiones: 0,
    proyectadoBytes: 0,
    porEstado: {},
    capacidad: null,
  };

  let actual: Ocupacion | null = null;
  const informarCapacidad = (decision: DecisionCapacidad, antes: Ocupacion | null, despues: Ocupacion | null) => {
    informe.capacidad = {
      plan: capacidad!.plan,
      antes,
      despues,
      diferencia: antes && despues ? diferenciaOcupacion(antes, despues) : null,
      decision,
    };
  };

  let antes: Ocupacion | null = null;
  if (capacidad) {
    antes = await medirSeguro(capacidad.medir);
    actual = antes;
  }

  if (!entrada.aplicar) {
    const candidatas = plan.tareas.slice(0, limites.maxTareas);
    informe.proyectadoBytes = candidatas.reduce((s, t) => s + proyectarCrecimiento(tasas, t.estimacion), 0);
    if (capacidad) {
      informarCapacidad(
        evaluarCapacidad({
          actualBytes: antes?.logicoBytes ?? null,
          proyectadoBytes: informe.proyectadoBytes,
          plan: capacidad.plan,
          pendientes: resumenPendientes(plan.tareas),
        }),
        antes,
        null,
      );
    }
    return informe;
  }

  let fallosSeguidos = 0;
  let primera = true;
  while (informe.pendientes.length > 0) {
    if (informe.ejecutadas.length >= limites.maxTareas) {
      informe.parada = 'limite_tareas';
      break;
    }
    if (informe.peticiones >= limites.maxPeticiones) {
      informe.parada = 'limite_peticiones';
      break;
    }
    if (entrada.ahora() - inicio >= limites.maxMs) {
      informe.parada = 'limite_tiempo';
      break;
    }

    const tarea = informe.pendientes[0];

    if (capacidad) {
      if (!primera) actual = await medirSeguro(capacidad.medir);
      const proyectado = proyectarCrecimiento(tasas, tarea.estimacion);
      informe.proyectadoBytes += proyectado;
      const decision = evaluarCapacidad({
        actualBytes: actual?.logicoBytes ?? null,
        proyectadoBytes: proyectado,
        plan: capacidad.plan,
        pendientes: resumenPendientes(informe.pendientes),
      });
      if (!decision.continuar) {
        informe.proyectadoBytes -= proyectado;
        informe.parada = 'capacidad';
        informarCapacidad(decision, antes, null);
        break;
      }
    }
    primera = false;

    informe.pendientes.shift();
    const ejecutada = await ejecutarConReintentos(entrada, tarea);
    informe.ejecutadas.push(ejecutada);
    informe.peticiones += ejecutada.resultado.peticiones;
    informe.porEstado[ejecutada.resultado.estado] = (informe.porEstado[ejecutada.resultado.estado] ?? 0) + 1;
    if (entrada.alTerminarTarea) await entrada.alTerminarTarea(tarea, ejecutada.resultado);

    const { resultado } = ejecutada;
    if (resultado.estado === 'esquema_no_aplicado') {
      informe.parada = 'esquema_no_aplicado';
      break;
    }
    if (resultado.estado === 'error' && resultado.tecnico) {
      if (resultado.tecnico.status === 429) {
        informe.parada = 'limite_remoto';
        break;
      }
      fallosSeguidos += 1;
      if (fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
        informe.parada = 'fallos_seguidos';
        break;
      }
    } else {
      fallosSeguidos = 0;
    }
  }

  if (capacidad) {
    const despues = informe.ejecutadas.length > 0 ? await medirSeguro(capacidad.medir) : null;
    if (informe.capacidad) {
      informarCapacidad(informe.capacidad.decision, antes, despues);
    } else {
      informarCapacidad(
        evaluarCapacidad({
          actualBytes: despues?.logicoBytes ?? antes?.logicoBytes ?? null,
          proyectadoBytes: 0,
          plan: capacidad.plan,
          pendientes: resumenPendientes(informe.pendientes),
        }),
        antes,
        despues,
      );
    }
  }
  return informe;
}

async function ejecutarConReintentos(entrada: EntradaLote, tarea: Tarea): Promise<TareaEjecutada> {
  const { limites } = entrada;
  let peticiones = 0;
  let ultimo: { status: number | null; retryAfterMs: number | null } | null = null;
  let mensaje = '';

  for (let intento = 0; intento <= limites.maxReintentos; intento += 1) {
    if (intento > 0) await entrada.dormir(esperaDeReintento(intento - 1, ultimo?.retryAfterMs ?? null, limites));
    try {
      const r = await entrada.ejecutar(tarea);
      peticiones += r.peticiones;
      if (!(r.estado === 'error' && r.tecnico)) {
        return { tarea, resultado: { ...r, peticiones }, reintentos: intento };
      }
      ultimo = r.tecnico;
      mensaje = r.mensaje ?? 'Fallo técnico de la fuente';
    } catch (e) {
      peticiones += 1;
      const tecnico = clasificarFalloTecnico(e);
      const texto = e instanceof Error ? e.message : String(e);
      if (!tecnico) {
        return { tarea, resultado: { estado: 'error', peticiones, mensaje: texto }, reintentos: intento };
      }
      ultimo = tecnico;
      mensaje = texto;
    }
  }
  return {
    tarea,
    resultado: { estado: 'error', peticiones, mensaje, tecnico: ultimo ?? { status: null, retryAfterMs: null } },
    reintentos: limites.maxReintentos,
  };
}
