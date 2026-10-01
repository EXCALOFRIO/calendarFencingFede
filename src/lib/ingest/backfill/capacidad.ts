/**
 * Capacidad lógica de la base para el backfill: medir antes y después, proyectar
 * el siguiente lote y parar ANTES de rebasar el margen.
 *
 * El plan real de Neon no está verificado, así que mientras no se confirme se
 * aplica el umbral conservador de 0,4 GiB (el nivel Free publicado es 0,5
 * GiB/proyecto). Todo es lógico (tablas + índices), no almacenamiento
 * facturado. Este módulo no compra, migra ni oculta temporadas: sólo decide
 * si el siguiente lote cabe y redacta lo que hay que decidir cuando no.
 */

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

/** Umbral de parada mientras el plan sea desconocido o Free. */
export const UMBRAL_CONSERVADOR_BYTES = Math.round(0.4 * GIB);

/** Medición lógica inicial de la base (27,71 MiB), distinta del consumo facturado. */
export const BASE_LOGICA_OBSERVADA_BYTES = Math.round(27.71 * MIB);

export type PlanNeon =
  | { tipo: 'desconocido' }
  | { tipo: 'free' }
  | { tipo: 'otro'; umbralVerificadoBytes: number; verificadoEn: string };

export type UmbralCapacidad = { umbralBytes: number; confirmado: boolean; descripcion: string };

export function umbralDePlan(plan: PlanNeon): UmbralCapacidad {
  if (plan.tipo === 'free') {
    return {
      umbralBytes: UMBRAL_CONSERVADOR_BYTES,
      confirmado: true,
      descripcion: 'Neon Free: se para en 0,4 GiB lógicos, por debajo de la cuota publicada de 0,5 GiB',
    };
  }
  if (plan.tipo === 'otro') {
    const v = plan.umbralVerificadoBytes;
    if (Number.isFinite(v) && v > 0) {
      return {
        umbralBytes: v,
        confirmado: true,
        descripcion: `Plan confirmado el ${plan.verificadoEn}: se para en ${formatoBytes(v)}`,
      };
    }
  }
  return {
    umbralBytes: UMBRAL_CONSERVADOR_BYTES,
    confirmado: false,
    descripcion: 'Plan de Neon no verificado: se usa el umbral conservador de 0,4 GiB hasta confirmarlo',
  };
}

export function formatoBytes(bytes: number): string {
  if (Math.abs(bytes) >= GIB / 4) return `${(bytes / GIB).toFixed(2)} GiB`;
  return `${(bytes / MIB).toFixed(2)} MiB`;
}

export type TasasCrecimiento = {
  bytesPorPuesto: number;
  bytesPorAsalto: number;
  bytesPorDocumento: number;
  /** Sobrecoste fijo de cada unidad (cobertura/checkpoint, edición, prueba). */
  bytesPorUnidad: number;
  origen: 'supuesto' | 'medido';
};

/** Tasas por fila con holgura (fila + índices + persona nueva); no son una medición. */
export const TASAS_CONSERVADORAS: TasasCrecimiento = {
  bytesPorPuesto: 1200,
  bytesPorAsalto: 900,
  bytesPorDocumento: 4096,
  bytesPorUnidad: 4096,
  origen: 'supuesto',
};

export type EstimacionLote = { puestos: number; asaltos: number; documentos: number; unidades: number };

export function proyectarCrecimiento(tasas: TasasCrecimiento, e: EstimacionLote): number {
  return (
    e.puestos * tasas.bytesPorPuesto +
    e.asaltos * tasas.bytesPorAsalto +
    e.documentos * tasas.bytesPorDocumento +
    e.unidades * tasas.bytesPorUnidad
  );
}

export type DecisionCapacidad = {
  continuar: boolean;
  motivo: 'ok' | 'umbral_alcanzado' | 'lote_rebasa_umbral' | 'sin_medicion';
  actualBytes: number | null;
  proyectadoBytes: number;
  umbralBytes: number;
  restanteBytes: number | null;
  planConfirmado: boolean;
  mensaje: string;
};

/**
 * Sólo continúa si `actual + proyectado` queda ESTRICTAMENTE por debajo del
 * umbral: llegar justo al umbral ya es rebasar el margen. Sin medición no hay
 * forma de verificarlo y tampoco se continúa.
 */
export function evaluarCapacidad(entrada: {
  actualBytes: number | null;
  proyectadoBytes: number;
  plan: PlanNeon;
  pendientes?: { unidades: number; temporadas?: readonly string[] };
}): DecisionCapacidad {
  const { actualBytes, proyectadoBytes, plan } = entrada;
  const u = umbralDePlan(plan);
  const base = { actualBytes, proyectadoBytes, umbralBytes: u.umbralBytes, planConfirmado: u.confirmado };

  if (actualBytes === null || !Number.isFinite(actualBytes)) {
    return {
      ...base,
      continuar: false,
      motivo: 'sin_medicion',
      restanteBytes: null,
      mensaje: mensajeDeParada('No se pudo medir la ocupación: sin medición no se puede verificar el margen.', u, null, entrada.pendientes),
    };
  }
  const restante = u.umbralBytes - actualBytes - proyectadoBytes;
  if (actualBytes >= u.umbralBytes) {
    return {
      ...base,
      continuar: false,
      motivo: 'umbral_alcanzado',
      restanteBytes: u.umbralBytes - actualBytes,
      mensaje: mensajeDeParada(
        `La base ya ocupa ${formatoBytes(actualBytes)} y alcanza el umbral.`,
        u,
        actualBytes,
        entrada.pendientes,
      ),
    };
  }
  if (restante <= 0) {
    return {
      ...base,
      continuar: false,
      motivo: 'lote_rebasa_umbral',
      restanteBytes: u.umbralBytes - actualBytes,
      mensaje: mensajeDeParada(
        `La base ocupa ${formatoBytes(actualBytes)} y el siguiente lote (${formatoBytes(proyectadoBytes)} proyectados) alcanzaría el umbral.`,
        u,
        actualBytes,
        entrada.pendientes,
      ),
    };
  }
  return {
    ...base,
    continuar: true,
    motivo: 'ok',
    restanteBytes: restante,
    mensaje: `Capacidad suficiente: ${formatoBytes(actualBytes)} + ${formatoBytes(proyectadoBytes)} de ${formatoBytes(u.umbralBytes)}. ${u.descripcion}.`,
  };
}

function mensajeDeParada(
  causa: string,
  u: UmbralCapacidad,
  actual: number | null,
  pendientes: { unidades: number; temporadas?: readonly string[] } | undefined,
): string {
  const partes = [
    `Carga detenida antes de rebasar el margen. ${causa}`,
    `Umbral: ${formatoBytes(u.umbralBytes)}. ${u.descripcion}.`,
  ];
  if (actual !== null) partes.push(`Ocupación lógica actual: ${formatoBytes(actual)}.`);
  if (pendientes) {
    const temporadas = pendientes.temporadas?.length ? ` (temporadas: ${pendientes.temporadas.join(', ')})` : '';
    partes.push(`Quedan ${pendientes.unidades} unidades pendientes${temporadas}; no se han descartado ni ocultado.`);
  }
  partes.push(
    'Hace falta una decisión del propietario antes de continuar. Alternativas, ninguna ejecutada: ' +
      'verificar el plan y el almacenamiento facturado de Neon; ampliar el plan de Neon; mover documentos y archivos grandes a R2 o ' +
      'datos a D1 tras medir costes y compatibilidad; o acotar el alcance histórico de forma explícita. ' +
      'No se ha contratado ni migrado nada.',
  );
  return partes.join(' ');
}

// ---------------------------------------------------------------------------
// Ocupación medida
// ---------------------------------------------------------------------------

export type TablaOcupacion = {
  tabla: string;
  tablaBytes: number;
  indicesBytes: number;
  totalBytes: number;
  filas: number;
};

export type ConteosOcupacion = {
  personas: number;
  pruebas: number;
  puestos: number;
  asaltos: number;
  /** Documentos (PDF) registrados como cobertura: sólo referencia y SHA-256, nunca el binario. */
  documentos: number;
  coberturas: number;
};

export type Ocupacion = {
  medidoEn: string;
  /** Suma de tablas + índices + TOAST del esquema público: lo que gobierna el umbral. */
  logicoBytes: number;
  /** `pg_database_size`, informativo. */
  baseDatosBytes: number | null;
  tablas: TablaOcupacion[];
  conteos: ConteosOcupacion;
};

export type DiferenciaOcupacion = {
  logicoDeltaBytes: number;
  porTabla: {
    tabla: string;
    tablaDelta: number;
    indicesDelta: number;
    totalDelta: number;
    filasDelta: number;
  }[];
  conteosDelta: ConteosOcupacion;
};

export function diferenciaOcupacion(antes: Ocupacion, despues: Ocupacion): DiferenciaOcupacion {
  const previas = new Map(antes.tablas.map((t) => [t.tabla, t]));
  const nombres = new Set([...antes.tablas.map((t) => t.tabla), ...despues.tablas.map((t) => t.tabla)]);
  const posteriores = new Map(despues.tablas.map((t) => [t.tabla, t]));
  const porTabla = [...nombres].sort().map((tabla) => {
    const a = previas.get(tabla);
    const d = posteriores.get(tabla);
    return {
      tabla,
      tablaDelta: (d?.tablaBytes ?? 0) - (a?.tablaBytes ?? 0),
      indicesDelta: (d?.indicesBytes ?? 0) - (a?.indicesBytes ?? 0),
      totalDelta: (d?.totalBytes ?? 0) - (a?.totalBytes ?? 0),
      filasDelta: (d?.filas ?? 0) - (a?.filas ?? 0),
    };
  });
  const claves = Object.keys(antes.conteos) as (keyof ConteosOcupacion)[];
  const conteosDelta = Object.fromEntries(
    claves.map((k) => [k, despues.conteos[k] - antes.conteos[k]]),
  ) as ConteosOcupacion;
  return { logicoDeltaBytes: despues.logicoBytes - antes.logicoBytes, porTabla, conteosDelta };
}

/** Filas añadidas por debajo de este número dan una tasa demasiado ruidosa para fiarse. */
const FILAS_MINIMAS_PARA_TASA = 50;

/**
 * Tasas por fila medidas en un lote real. Con menos de 50 filas añadidas a una
 * tabla se mantiene la tasa supuesta de esa tabla: el redondeo de páginas de
 * 8 KiB distorsiona una muestra pequeña.
 */
export function tasasDesdeMedicion(antes: Ocupacion, despues: Ocupacion): TasasCrecimiento {
  const d = diferenciaOcupacion(antes, despues);
  const tasa = (tabla: string, respaldo: number) => {
    const t = d.porTabla.find((x) => x.tabla === tabla);
    if (!t || t.filasDelta < FILAS_MINIMAS_PARA_TASA || t.totalDelta <= 0) return { valor: respaldo, medido: false };
    return { valor: Math.ceil(t.totalDelta / t.filasDelta), medido: true };
  };
  const puesto = tasa('sport_result', TASAS_CONSERVADORAS.bytesPorPuesto);
  const asalto = tasa('sport_bout', TASAS_CONSERVADORAS.bytesPorAsalto);
  return {
    bytesPorPuesto: puesto.valor,
    bytesPorAsalto: asalto.valor,
    bytesPorDocumento: TASAS_CONSERVADORAS.bytesPorDocumento,
    bytesPorUnidad: TASAS_CONSERVADORAS.bytesPorUnidad,
    origen: puesto.medido || asalto.medido ? 'medido' : 'supuesto',
  };
}
