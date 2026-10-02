/**
 * Piloto de IA sobre PDF: tope de 10 documentos y 1 € en total.
 *
 * Este módulo es el limitador. No habla con ningún modelo: recibe un `invocar`
 * y sólo lo llama si todas las guardas pasan. Las cifras de coste de aquí son
 * dos cosas distintas que nunca se mezclan:
 *
 *  - ESTIMACIÓN previa y conservadora (tokens supuestos × tarifa publicada).
 *    Sirve para decidir si una llamada cabe; no es una factura.
 *  - Coste OBSERVADO, que sólo existe si una vía verificada devolvió el uso real,
 *    y coste SIMULADO, que sale de un `invocar` falso y vive en un libro propio.
 *
 * Los importes se llevan en micro-euros enteros para que sumar 10 operaciones
 * no dependa del redondeo de coma flotante justo en el tope de 1 €.
 */

export type ModoPiloto = 'simulacion' | 'real';

export const PILOTO_IA = {
  maxDocumentos: 10,
  presupuestoMaxMicroEur: 1_000_000,
  /** Mismo tope de texto que la extracción de convocatorias (`MAX_CARACTERES_DOCUMENTO`). */
  maxCaracteresEnviados: 120_000,
  /** Tope duro de salida que se pasaría al modelo: el peor caso de salida se paga entero. */
  maxTokensSalida: 8192,
  /** Prompt de sistema + esquema JSON medidos en 18.229 bytes; se asume 1 token por byte y margen. */
  tokensFijosPromptPeorCaso: 20_000,
  margenSeguridad: 1.25,
  /** El euro cotiza por encima del dólar: 1 € = 1 US$ sobreestima y por tanto nunca queda corto. */
  eurPorUsd: 1,
} as const;

export type TarifaModelo = {
  modelo: string;
  usdPorMillonEntrada: number;
  usdPorMillonSalida: number;
  fuente: string;
  consultadaEl: string;
};

/**
 * Una tarifa publicada no prueba que la cuenta tenga cuota, plan ni acceso: sólo
 * permite acotar el coste del peor caso. Un modelo sin fila aquí no se puede enviar.
 */
export const TARIFAS_WORKERS_AI: Readonly<Record<string, TarifaModelo>> = {
  '@cf/zai-org/glm-5.3-flash': {
    modelo: '@cf/zai-org/glm-5.3-flash',
    usdPorMillonEntrada: 0.15,
    usdPorMillonSalida: 0.5,
    fuente: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    consultadaEl: '2026-10-02',
  },
};

export const MODELO_PILOTO = '@cf/zai-org/glm-5.3-flash';

export type EvidenciaViaIa = {
  /** Una inferencia real aceptada por la cuenta, comprobada por un cauce oficial. */
  accesoInferenciaCuenta: boolean;
  /** Modelo concreto confirmado como disponible para esa cuenta. */
  modeloConfirmado: string | null;
  /** Plan, cuota y precio efectivo de la cuenta (no sólo la tarifa pública). */
  planYCuotaCuenta: boolean;
  /** Condiciones de uso/no entrenamiento aplicables a los datos que se enviarían. */
  condicionesDatosAceptadas: boolean;
  /** Visto bueno explícito del usuario para enviar documentos al piloto. */
  aprobacionExplicita: boolean;
};

/**
 * Estado a 02/10/2026. La documentación pública de Cloudflare publica la tarifa y
 * dice que no entrena con el contenido del cliente, pero eso no es acceso, cuota
 * ni plan de ESTA cuenta: el token del proyecto no tiene permiso de Workers AI
 * (la vía REST responde 401). El usuario aprobó un piloto de hasta 10 PDF y 1 €,
 * pero esa bandera se mantiene a `false` mientras la vía no esté verificada: el
 * visto bueno de presupuesto no sustituye al de enviar un documento concreto.
 */
export const VIA_IA_ACTUAL: EvidenciaViaIa = {
  accesoInferenciaCuenta: false,
  modeloConfirmado: null,
  planYCuotaCuenta: false,
  condicionesDatosAceptadas: false,
  aprobacionExplicita: false,
};

export function carenciasDeVia(via: EvidenciaViaIa, modelo: string = MODELO_PILOTO): string[] {
  const faltan: string[] = [];
  if (!via.accesoInferenciaCuenta) faltan.push('acceso_inferencia_cuenta');
  if (via.modeloConfirmado !== modelo) faltan.push('modelo_confirmado');
  if (!via.planYCuotaCuenta) faltan.push('plan_y_cuota_cuenta');
  if (!via.condicionesDatosAceptadas) faltan.push('condiciones_datos');
  if (!via.aprobacionExplicita) faltan.push('aprobacion_explicita');
  return faltan;
}

export const viaVerificada = (via: EvidenciaViaIa, modelo: string = MODELO_PILOTO): boolean => carenciasDeVia(via, modelo).length === 0;

export type PrivacidadDocumento = 'sin_datos_personales' | 'nominal' | 'desconocida';

export type DocumentoPiloto = {
  /** Huella SHA-256 del PDF: identifica el documento sin guardar nombre ni URL nominal. */
  documentoId: string;
  paginas: number;
  bytes: number;
  /** Caracteres de texto que se enviarían, ya minimizados. */
  caracteres: number;
  /** Sólo `sin_datos_personales` se puede enviar; lo demás es un bloqueo. */
  privacidad: PrivacidadDocumento;
};

export type NombreEscenario = 'bajo' | 'base' | 'conservador';

export type EscenarioCoste = {
  nombre: NombreEscenario;
  tokensEntrada: number;
  tokensSalida: number;
  costeUsd: number;
  costeMicroEur: number;
  naturaleza: 'estimacion_previa_no_factura';
};

export type EstimacionCoste = {
  modelo: string;
  escenarios: Record<NombreEscenario, EscenarioCoste>;
  /** El escenario con el que deciden las guardas: siempre el conservador. */
  aplicado: EscenarioCoste;
};

const CARACTERES_POR_TOKEN: Record<NombreEscenario, number> = { bajo: 4, base: 3, conservador: 1 };
const FRACCION_SALIDA: Record<NombreEscenario, number> = { bajo: 0.25, base: 0.5, conservador: 1 };

export function estimarCoste(doc: Pick<DocumentoPiloto, 'caracteres'>, modelo: string = MODELO_PILOTO): EstimacionCoste | null {
  const tarifa = TARIFAS_WORKERS_AI[modelo];
  if (!tarifa || !Number.isFinite(doc.caracteres) || doc.caracteres < 0) return null;
  const { tokensFijosPromptPeorCaso, maxTokensSalida, margenSeguridad, eurPorUsd } = PILOTO_IA;
  const escenario = (nombre: NombreEscenario): EscenarioCoste => {
    const tokensEntrada = Math.ceil(doc.caracteres / CARACTERES_POR_TOKEN[nombre]) + tokensFijosPromptPeorCaso;
    const tokensSalida = Math.ceil(maxTokensSalida * FRACCION_SALIDA[nombre]);
    const costeUsd = (tokensEntrada * tarifa.usdPorMillonEntrada + tokensSalida * tarifa.usdPorMillonSalida) / 1_000_000;
    return {
      nombre,
      tokensEntrada,
      tokensSalida,
      costeUsd,
      costeMicroEur: Math.ceil(costeUsd * eurPorUsd * margenSeguridad * 1_000_000),
      naturaleza: 'estimacion_previa_no_factura',
    };
  };
  const escenarios = { bajo: escenario('bajo'), base: escenario('base'), conservador: escenario('conservador') };
  return { modelo, escenarios, aplicado: escenarios.conservador };
}

export type MotivoBloqueo =
  | 'limite_documentos'
  | 'documento_ya_intentado'
  | 'presupuesto_excedido'
  | 'via_no_verificada'
  | 'privacidad_no_acreditada'
  | 'sin_tarifa_modelo'
  | 'documento_invalido'
  | 'supera_tope_caracteres';

export type EntradaLibro = {
  documentoId: string;
  estado: 'reservada' | 'liquidada' | 'fallida';
  estimadoMicroEur: number;
  /** Sólo en modo real y sólo con el uso devuelto por la vía verificada. */
  observadoMicroEur: number | null;
  /** Sólo en modo simulación: nunca es consumo. */
  simuladoMicroEur: number | null;
  paginas: number;
  bytes: number;
  caracteres: number;
  en: string;
  detalle: string | null;
};

export type EstadoPiloto = {
  version: 1;
  modo: ModoPiloto;
  entradas: EntradaLibro[];
  bloqueos: { documentoId: string; motivos: MotivoBloqueo[]; en: string }[];
};

export const MAX_BLOQUEOS_GUARDADOS = 100;

export const estadoVacio = (modo: ModoPiloto): EstadoPiloto => ({ version: 1, modo, entradas: [], bloqueos: [] });

/**
 * Una reserva o un fallo cuentan por su estimación porque no se sabe si se
 * facturó; sólo una liquidación cuenta por su coste real o simulado.
 */
export function comprometidoMicroEur(estado: EstadoPiloto): number {
  return estado.entradas.reduce((suma, e) => {
    if (e.estado !== 'liquidada') return suma + e.estimadoMicroEur;
    return suma + (e.observadoMicroEur ?? e.simuladoMicroEur ?? e.estimadoMicroEur);
  }, 0);
}

export type ContextoGuardas = {
  modo: ModoPiloto;
  via: EvidenciaViaIa;
  modelo?: string;
};

export function evaluarGuardas(estado: EstadoPiloto, doc: DocumentoPiloto, ctx: ContextoGuardas): { motivos: MotivoBloqueo[]; estimacion: EstimacionCoste | null } {
  const modelo = ctx.modelo ?? MODELO_PILOTO;
  const motivos: MotivoBloqueo[] = [];
  const valido =
    doc.documentoId.length > 0 &&
    [doc.paginas, doc.bytes, doc.caracteres].every((n) => Number.isFinite(n) && n >= 0) &&
    doc.paginas > 0;
  if (!valido) motivos.push('documento_invalido');
  if (estado.entradas.length >= PILOTO_IA.maxDocumentos) motivos.push('limite_documentos');
  if (estado.entradas.some((e) => e.documentoId === doc.documentoId)) motivos.push('documento_ya_intentado');
  if (valido && doc.caracteres > PILOTO_IA.maxCaracteresEnviados) motivos.push('supera_tope_caracteres');
  if (doc.privacidad !== 'sin_datos_personales') motivos.push('privacidad_no_acreditada');
  if (ctx.modo === 'real' && !viaVerificada(ctx.via, modelo)) motivos.push('via_no_verificada');

  const estimacion = valido ? estimarCoste(doc, modelo) : null;
  if (valido && !estimacion) motivos.push('sin_tarifa_modelo');
  if (estimacion && comprometidoMicroEur(estado) + estimacion.aplicado.costeMicroEur > PILOTO_IA.presupuestoMaxMicroEur) {
    motivos.push('presupuesto_excedido');
  }
  return { motivos, estimacion };
}

export interface AlmacenPiloto {
  readonly modo: ModoPiloto;
  /** `fn` muta el estado y, si no lanza, el almacén lo persiste antes de devolver. */
  transaccion<T>(fn: (estado: EstadoPiloto) => T): Promise<T>;
}

export function crearAlmacenMemoria(modo: ModoPiloto, inicial?: EstadoPiloto): AlmacenPiloto & { leer(): EstadoPiloto } {
  let estado = structuredClone(inicial ?? estadoVacio(modo));
  let cola: Promise<unknown> = Promise.resolve();
  return {
    modo,
    leer: () => structuredClone(estado),
    transaccion<T>(fn: (e: EstadoPiloto) => T): Promise<T> {
      const paso = cola.then(() => {
        const copia = structuredClone(estado);
        const valor = fn(copia);
        estado = copia;
        return valor;
      });
      cola = paso.catch(() => undefined);
      return paso;
    },
  };
}

export type ClienteInferencia = (
  doc: DocumentoPiloto,
  ctx: { modelo: string; maxTokensSalida: number },
) => Promise<{ costeMicroEur: number }>;

export type ResultadoPiloto =
  | { estado: 'bloqueado'; enviado: false; motivos: MotivoBloqueo[]; estimacion: EstimacionCoste | null }
  | {
      estado: 'completado';
      enviado: true;
      naturalezaCoste: 'observado' | 'simulado';
      costeMicroEur: number;
      etiqueta: string;
      /** Una extracción de IA nunca se publica sola. */
      publicacion: 'pendiente_revision_humana';
    }
  | { estado: 'fallido'; enviado: true; motivo: string };

export type DepsPiloto = {
  almacen: AlmacenPiloto;
  via?: EvidenciaViaIa;
  invocar: ClienteInferencia;
  modelo?: string;
  ahora?: () => Date;
};

/**
 * Reserva antes de llamar y no reintenta: un fallo deja la estimación
 * contabilizada y el documento como intentado, porque no se sabe si se facturó.
 */
export async function procesarDocumentoPiloto(deps: DepsPiloto, doc: DocumentoPiloto): Promise<ResultadoPiloto> {
  const modelo = deps.modelo ?? MODELO_PILOTO;
  const via = deps.via ?? VIA_IA_ACTUAL;
  const ahora = (deps.ahora ?? (() => new Date()))().toISOString();
  const modo = deps.almacen.modo;

  const reserva = await deps.almacen.transaccion((estado) => {
    if (estado.modo !== modo) throw new Error(`El libro del piloto es de modo ${estado.modo} y la operación de ${modo}`);
    const { motivos, estimacion } = evaluarGuardas(estado, doc, { modo, via, modelo });
    if (motivos.length > 0 || !estimacion) {
      estado.bloqueos.push({ documentoId: doc.documentoId, motivos, en: ahora });
      if (estado.bloqueos.length > MAX_BLOQUEOS_GUARDADOS) estado.bloqueos.splice(0, estado.bloqueos.length - MAX_BLOQUEOS_GUARDADOS);
      return { motivos, estimacion };
    }
    estado.entradas.push({
      documentoId: doc.documentoId,
      estado: 'reservada',
      estimadoMicroEur: estimacion.aplicado.costeMicroEur,
      observadoMicroEur: null,
      simuladoMicroEur: null,
      paginas: doc.paginas,
      bytes: doc.bytes,
      caracteres: doc.caracteres,
      en: ahora,
      detalle: null,
    });
    return { motivos: [] as MotivoBloqueo[], estimacion };
  });

  if (reserva.motivos.length > 0 || !reserva.estimacion) {
    return { estado: 'bloqueado', enviado: false, motivos: reserva.motivos, estimacion: reserva.estimacion };
  }

  const cerrar = (cambios: Partial<EntradaLibro>) =>
    deps.almacen.transaccion((estado) => {
      const entrada = estado.entradas.find((e) => e.documentoId === doc.documentoId && e.estado === 'reservada');
      if (entrada) Object.assign(entrada, cambios);
    });

  let coste: number;
  try {
    ({ costeMicroEur: coste } = await deps.invocar(doc, { modelo, maxTokensSalida: PILOTO_IA.maxTokensSalida }));
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await cerrar({ estado: 'fallida', detalle: `error_invocacion: ${motivo.slice(0, 200)}` });
    return { estado: 'fallido', enviado: true, motivo };
  }
  if (!Number.isFinite(coste) || coste < 0) {
    await cerrar({ estado: 'fallida', detalle: 'coste_devuelto_invalido' });
    return { estado: 'fallido', enviado: true, motivo: 'El proveedor no devolvió un coste válido' };
  }

  const costeEntero = Math.ceil(coste);
  const real = modo === 'real';
  await cerrar({
    estado: 'liquidada',
    observadoMicroEur: real ? costeEntero : null,
    simuladoMicroEur: real ? null : costeEntero,
    detalle: costeEntero > reserva.estimacion.aplicado.costeMicroEur ? 'supero_estimacion' : null,
  });
  return {
    estado: 'completado',
    enviado: true,
    naturalezaCoste: real ? 'observado' : 'simulado',
    costeMicroEur: costeEntero,
    etiqueta: real ? 'Coste observado devuelto por la vía verificada' : 'SIMULACION: no es consumo observado ni factura',
    publicacion: 'pendiente_revision_humana',
  };
}

export type EstadoPublicacionIa = 'descartado' | 'pendiente_revision' | 'publicable';

/** Nada extraído por IA se publica si es ambiguo, simulado o no lo ha visto una persona. */
export function estadoPublicacionIa(extraccion: {
  modo: ModoPiloto;
  ambigua: boolean;
  citasVerificadas: boolean;
  revisadaPorPersona: boolean;
}): EstadoPublicacionIa {
  if (extraccion.modo === 'simulacion' || extraccion.ambigua || !extraccion.citasVerificadas) return 'descartado';
  return extraccion.revisadaPorPersona ? 'publicable' : 'pendiente_revision';
}
