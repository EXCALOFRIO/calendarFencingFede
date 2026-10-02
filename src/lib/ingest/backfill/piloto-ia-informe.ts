import { pareceContenerDatosPersonales } from '@/lib/ai/extract';
import { extraerPaginas, sha256Hex } from '../sources/rfee-pdf/lectura';
import {
  type DocumentoPiloto,
  type EscenarioCoste,
  type EstadoPiloto,
  type EstimacionCoste,
  type EvidenciaViaIa,
  type ModoPiloto,
  type MotivoBloqueo,
  type NombreEscenario,
  MODELO_PILOTO,
  PILOTO_IA,
  VIA_IA_ACTUAL,
  carenciasDeVia,
  comprometidoMicroEur,
  estadoVacio,
  evaluarGuardas,
} from './piloto-ia';

export type MedidaPdfLocal = DocumentoPiloto & { items: number };

/**
 * Mide un PDF en memoria: páginas, bytes y texto. Un PDF de resultados es por
 * naturaleza un listado de personas, así que sin una señal explícita en
 * contra su privacidad es `desconocida` o `nominal`, nunca `sin_datos_personales`.
 */
export async function medirPdfLocal(bytes: Uint8Array): Promise<MedidaPdfLocal> {
  const { paginas, perfil } = await extraerPaginas(bytes);
  const texto = paginas.map((p) => p.items.map((i) => i.s).join(' ')).join('\n');
  const deteccion = pareceContenerDatosPersonales(texto);
  return {
    documentoId: await sha256Hex(bytes),
    paginas: perfil.paginas,
    bytes: perfil.bytes,
    caracteres: texto.length,
    items: perfil.items,
    privacidad: deteccion.contieneDatosPersonales ? 'nominal' : 'desconocida',
  };
}

export type FilaInforme = {
  documentoId: string;
  paginas: number;
  bytes: number;
  caracteres: number;
  privacidad: DocumentoPiloto['privacidad'];
  escenarios: Record<NombreEscenario, EscenarioCoste> | null;
  bloqueos: MotivoBloqueo[];
};

export type InformePiloto = {
  naturaleza: 'informe_local_estimacion_no_factura';
  modo: ModoPiloto;
  modelo: string;
  limites: { maxDocumentos: number; presupuestoMaxMicroEur: number };
  via: { verificada: boolean; carencias: string[] };
  ejecucionReal: 'bloqueada' | 'permitida_por_guardas';
  documentos: FilaInforme[];
  totales: {
    documentos: number;
    elegibles: number;
    bloqueados: number;
    paginas: number;
    bytes: number;
    caracteres: number;
    estimacionMicroEur: Record<NombreEscenario, number>;
  };
  libro: {
    comprometidoMicroEur: number;
    documentosIntentados: number;
    observadoMicroEur: number;
    simuladoMicroEur: number;
  };
  aviso: string;
};

const CERO: Record<NombreEscenario, number> = { bajo: 0, base: 0, conservador: 0 };

/**
 * Plan en seco: aplica las guardas documento a documento sobre una copia del
 * libro, de modo que el undécimo y cualquier llamada que rebase el tope salen
 * bloqueados, sin escribir nada ni llamar a nadie.
 */
export function construirInformePiloto(
  documentos: DocumentoPiloto[],
  opciones: { modo?: ModoPiloto; via?: EvidenciaViaIa; libro?: EstadoPiloto; modelo?: string } = {},
): InformePiloto {
  const modo = opciones.modo ?? 'real';
  const via = opciones.via ?? VIA_IA_ACTUAL;
  const modelo = opciones.modelo ?? MODELO_PILOTO;
  const libro = structuredClone(opciones.libro ?? estadoVacio(modo));
  const carencias = carenciasDeVia(via, modelo);

  const filas: FilaInforme[] = [];
  const totales = { ...CERO };
  let elegibles = 0;
  for (const doc of documentos) {
    const { motivos, estimacion }: { motivos: MotivoBloqueo[]; estimacion: EstimacionCoste | null } = evaluarGuardas(libro, doc, { modo, via, modelo });
    filas.push({
      documentoId: doc.documentoId,
      paginas: doc.paginas,
      bytes: doc.bytes,
      caracteres: doc.caracteres,
      privacidad: doc.privacidad,
      escenarios: estimacion?.escenarios ?? null,
      bloqueos: motivos,
    });
    if (!estimacion) continue;
    for (const n of ['bajo', 'base', 'conservador'] as const) totales[n] += estimacion.escenarios[n].costeMicroEur;
    if (motivos.length === 0) elegibles += 1;
    // Reserva virtual de lo que sí cabría, para que el límite de 10 y el de 1 € se vean acumulados.
    if (motivos.length === 0 || motivos.every((m) => m === 'via_no_verificada' || m === 'privacidad_no_acreditada')) {
      libro.entradas.push({
        documentoId: doc.documentoId,
        estado: 'reservada',
        estimadoMicroEur: estimacion.aplicado.costeMicroEur,
        observadoMicroEur: null,
        simuladoMicroEur: null,
        paginas: doc.paginas,
        bytes: doc.bytes,
        caracteres: doc.caracteres,
        en: 'plan',
        detalle: 'reserva_virtual_del_informe',
      });
    }
  }

  const real = opciones.libro ?? estadoVacio(modo);
  return {
    naturaleza: 'informe_local_estimacion_no_factura',
    modo,
    modelo,
    limites: { maxDocumentos: PILOTO_IA.maxDocumentos, presupuestoMaxMicroEur: PILOTO_IA.presupuestoMaxMicroEur },
    via: { verificada: carencias.length === 0, carencias },
    ejecucionReal: modo === 'real' && carencias.length > 0 ? 'bloqueada' : 'permitida_por_guardas',
    documentos: filas,
    totales: {
      documentos: documentos.length,
      elegibles,
      bloqueados: documentos.length - elegibles,
      paginas: documentos.reduce((s, d) => s + d.paginas, 0),
      bytes: documentos.reduce((s, d) => s + d.bytes, 0),
      caracteres: documentos.reduce((s, d) => s + d.caracteres, 0),
      estimacionMicroEur: totales,
    },
    libro: {
      comprometidoMicroEur: comprometidoMicroEur(real),
      documentosIntentados: real.entradas.length,
      observadoMicroEur: real.entradas.reduce((s, e) => s + (e.observadoMicroEur ?? 0), 0),
      simuladoMicroEur: real.entradas.reduce((s, e) => s + (e.simuladoMicroEur ?? 0), 0),
    },
    aviso:
      'Las cifras por escenario son estimaciones previas con la tarifa pública y supuestos de tokens; no son consumo observado ni factura. ' +
      'El coste observado sólo existe tras una llamada real por una vía verificada y el simulado nunca cuenta como consumo.',
  };
}
