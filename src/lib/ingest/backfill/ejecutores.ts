import { persistirLecturaFie, type DepsPersistenciaFie } from '../fie-resultados-persist';
import { persistirEnlaces, type DepsComplemento } from '../complementarios-persist';
import type { DescubrimientoEnlaces } from '../enlaces-resultados';
import { persistirLecturaSkermo, type DepsPersistenciaSkermo } from '../skermo-finales-persist';
import { leerPruebaFie, TAMANO_PAGINA_RANKING, type DepsLecturaFie } from '../sources/fie-resultados';
import type { LecturaSkermo } from '../sources/skermo-finales';
import type { LecturaPdf } from '../sources/rfee-pdf/tipos';
import { desdeCursorFie } from './cursor-fie';
import {
  ejecutarEngardeTorneo,
  ejecutarFwwPrueba,
  type DepsComplementosJob,
} from './complementarios-job';
import type { CanonicaConPrimarios } from '../conciliar-torneo-engarde';
import { persistirLecturaPdf, type DepsPersistenciaPdf } from './pdf-persist';
import { clasificarFalloTecnico, type EstadoResultadoTarea, type ResultadoTarea, type Tarea } from './orquestador';

/**
 * Despacho de una tarea del backfill al adaptador de su fuente. Cada paso hace
 * lectura → comparación → escritura → checkpoint para UNA clave y devuelve un
 * resultado; el orquestador garantiza que no hay dos pasos de la misma clave a
 * la vez dentro de la ejecución. Todo entra por dependencias: aquí no hay red
 * ni base.
 */

export type DepsEjecutores = {
  fie: {
    lectura: DepsLecturaFie;
    persistencia: DepsPersistenciaFie;
    /** Cursor de continuación guardado AHORA (puede haber avanzado en un intento anterior del mismo lote). */
    cursorActual: (season: number, competitionId: number) => Promise<string | null>;
  };
  skermo?: {
    leer: (e: { federacion: string; season: string; competitionId: string; releer: boolean }) => Promise<LecturaSkermo>;
    persistencia: DepsPersistenciaSkermo;
  };
  pdf?: {
    leer: (url: string) => Promise<LecturaPdf>;
    persistencia: DepsPersistenciaPdf;
  };
  complementarios?: DepsComplementosJob & {
    cargarCanonicaPorId: (competitionId: string) => Promise<CanonicaConPrimarios | null>;
  };
  enlaces?: {
    descubrir: (season: number, competitionId: number) => Promise<DescubrimientoEnlaces>;
    persistencia: Pick<DepsComplemento, 'esquema' | 'upsertCobertura'>;
  };
};

const error = (mensaje: string, peticiones = 0): ResultadoTarea => ({ estado: 'error', peticiones, mensaje });

function falloTecnico(mensajes: readonly (string | null | undefined)[], peticiones: number): ResultadoTarea | null {
  for (const m of mensajes) {
    if (!m) continue;
    const tecnico = clasificarFalloTecnico(new Error(m));
    if (tecnico) return { estado: 'error', peticiones, mensaje: m, tecnico };
  }
  return null;
}

async function ejecutarFie(deps: DepsEjecutores['fie'], t: Tarea): Promise<ResultadoTarea> {
  const season = Number(t.season);
  const competitionId = Number(t.competitionKey);
  if (!Number.isInteger(season) || !Number.isInteger(competitionId)) {
    return error(`Clave FIE no válida: ${t.clave}`);
  }
  // Una relectura explícita vuelve a la página 1; el resto continúa donde quedó el último checkpoint.
  const desdePagina = t.releer
    ? 1
    : desdeCursorFie(await deps.cursorActual(season, competitionId), { season, competitionId, pageSize: TAMANO_PAGINA_RANKING });

  const lectura = await leerPruebaFie(season, competitionId, deps.lectura, {
    desdePagina,
    omitirAsaltos: desdePagina > 1,
  });
  const resumen = await persistirLecturaFie(deps.persistencia, lectura);
  if (resumen.estado === 'esquema_no_aplicado') return { estado: 'esquema_no_aplicado', peticiones: 0 };

  const peticiones =
    1 + (lectura.ranking?.paginasLeidas ?? 0) + (lectura.poules ? 1 : 0) + (lectura.cuadro ? 1 : 0) + (lectura.ranking?.cobertura.error ? 1 : 0);
  const hechos = {
    puestos: resumen.puestos.nuevos + resumen.puestos.revisados,
    asaltos: resumen.poules.nuevos + resumen.poules.revisados + resumen.cuadro.nuevos + resumen.cuadro.revisados,
  };

  if (!lectura.prueba) {
    return falloTecnico([lectura.errorPrueba], peticiones) ?? error(lectura.errorPrueba ?? 'La prueba no se pudo leer', peticiones);
  }
  // El progreso ya está persistido (cursor y cobertura): un fallo técnico se reintenta desde ahí.
  const tecnico = falloTecnico(
    [lectura.ranking?.cobertura.error, lectura.poules?.cobertura.error, lectura.cuadro?.cobertura.error],
    peticiones,
  );
  if (tecnico) return { ...tecnico, hechos };

  const estado = resumen.cobertura.ranking ?? 'pendiente';
  const mapa: Record<string, EstadoResultadoTarea> = {
    completo: 'completo',
    parcial: 'parcial',
    sin_resultados: 'sin_resultados',
    conflicto: 'conflicto',
    pendiente: 'pendiente',
    error: 'error',
  };
  return { estado: mapa[estado] ?? 'pendiente', peticiones, hechos };
}

async function ejecutarSkermo(deps: NonNullable<DepsEjecutores['skermo']>, t: Tarea): Promise<ResultadoTarea> {
  const separador = t.competitionKey.indexOf(':');
  if (separador <= 0) return error(`Clave Skermo no válida: ${t.clave}`);
  const federacion = t.competitionKey.slice(0, separador);
  const competitionId = t.competitionKey.slice(separador + 1);
  const lectura = await deps.leer({ federacion, season: t.season, competitionId, releer: t.releer });
  const resumen = await persistirLecturaSkermo(deps.persistencia, lectura);
  if (resumen.estado === 'esquema_no_aplicado' && resumen.cobertura !== 'pendiente') {
    return { estado: 'esquema_no_aplicado', peticiones: 1 };
  }
  const hechos = { puestos: resumen.puestos.nuevos + resumen.puestos.revisados };
  if (lectura.cobertura.estado === 'error') {
    return falloTecnico([lectura.cobertura.error], 1) ?? error(lectura.cobertura.error ?? 'Lectura Skermo fallida', 1);
  }
  if (resumen.estado === 'esquema_no_aplicado') {
    // Categoría M10/M12 sin la migración 0019: queda pendiente con su motivo, no es un error.
    return { estado: 'pendiente', peticiones: 1, mensaje: 'Categoría pendiente de la migración 0019' };
  }
  const estado = resumen.cobertura ?? lectura.cobertura.estado;
  return { estado: (estado as EstadoResultadoTarea) ?? 'pendiente', peticiones: 1, hechos };
}

async function ejecutarPdf(deps: NonNullable<DepsEjecutores['pdf']>, t: Tarea): Promise<ResultadoTarea> {
  const url = typeof t.datos?.sourceUrl === 'string' ? t.datos.sourceUrl : null;
  if (!url) return error(`El documento ${t.clave} no tiene URL registrada`);
  const lectura = await deps.leer(url);
  const resumen = await persistirLecturaPdf(deps.persistencia, lectura, { season: t.season }, { releer: t.releer });
  if (resumen.estado === 'esquema_no_aplicado') return { estado: 'esquema_no_aplicado', peticiones: 1 };
  if (resumen.estado === 'documento_no_leido') {
    if (resumen.motivo === 'tecnico') {
      return falloTecnico([lectura.error], 1) ?? error(lectura.error ?? 'Documento no leído', 1);
    }
    // Límite de tamaño/páginas o host no admitido: pendiente de decisión, no se reintenta a ciegas.
    return { estado: 'pendiente', peticiones: 1, mensaje: lectura.error ?? resumen.motivo ?? undefined };
  }
  if (resumen.estado === 'sin_cambios') return { estado: 'sin_cambios', peticiones: 1 };
  const mapa: Record<string, EstadoResultadoTarea> = {
    completo: 'completo',
    parcial: 'parcial',
    sin_resultados: 'sin_resultados',
    conflicto: 'conflicto',
    pendiente: 'pendiente',
    error: 'error',
  };
  return {
    estado: mapa[resumen.documento ?? 'pendiente'] ?? 'pendiente',
    peticiones: 1,
    hechos: { puestos: resumen.puestos.nuevos + resumen.puestos.revisados, asaltos: resumen.asaltos.nuevos + resumen.asaltos.revisados, documentos: 1 },
  };
}

async function ejecutarEnlaces(deps: NonNullable<DepsEjecutores['enlaces']>, t: Tarea): Promise<ResultadoTarea> {
  const season = Number(t.season);
  const competitionId = Number(t.competitionKey);
  if (!Number.isInteger(season) || !Number.isInteger(competitionId)) return error(`Clave FIE no válida: ${t.clave}`);
  const d = await deps.descubrir(season, competitionId);
  const estadosHttp = [d.ficha.htmlStatus, d.ficha.jsonStatus].filter((s): s is number => typeof s === 'number');
  if (!d.prueba || !d.enlaces) {
    const fallo = estadosHttp.find((s) => s === 429 || s >= 500);
    if (fallo !== undefined && d.ficha.datos === 'ninguno') {
      return { estado: 'error', peticiones: 2, mensaje: `HTTP ${fallo} al pedir la ficha FIE`, tecnico: { status: fallo, retryAfterMs: null } };
    }
    // Sin JSON legible no hay nada que evaluar, y eso no equivale a «aún no publicado».
    return { estado: 'sin_cambios', peticiones: 2, mensaje: 'Sin prueba oficial legible: no se evalúa ningún enlace' };
  }
  if (!(await deps.persistencia.esquema()).identidad) return { estado: 'esquema_no_aplicado', peticiones: 2 };
  await persistirEnlaces(deps.persistencia, d.prueba, d.enlaces);
  return { estado: 'completo', peticiones: 2 };
}

export function crearEjecutor(deps: DepsEjecutores): (t: Tarea) => Promise<ResultadoTarea> {
  return async (t) => {
    switch (t.tipo) {
      case 'fie_prueba':
        return ejecutarFie(deps.fie, t);
      case 'skermo_prueba':
        return deps.skermo ? ejecutarSkermo(deps.skermo, t) : error('Skermo no está configurado en este modo');
      case 'pdf_documento':
        return deps.pdf ? ejecutarPdf(deps.pdf, t) : error('La lectura de PDF no está configurada en este modo');
      case 'engarde_torneo': {
        if (!deps.complementarios) return error('Engarde no está configurado en este modo');
        const [org, evt] = t.competitionKey.split('/');
        if (!org || !evt) return error(`Clave Engarde no válida: ${t.clave}`);
        return ejecutarEngardeTorneo(deps.complementarios, org, evt);
      }
      case 'fww_prueba': {
        if (!deps.complementarios) return error('FWW no está configurado en este modo');
        const competitionId = typeof t.datos?.competitionId === 'string' ? t.datos.competitionId : null;
        const canonica = competitionId ? await deps.complementarios.cargarCanonicaPorId(competitionId) : null;
        // Sin canónica cargada no hay con qué cotejar: queda diferido, no se fuerza ni se vacía.
        if (!canonica) return { estado: 'pendiente', peticiones: 0, mensaje: 'La prueba canónica aún no está cargada' };
        const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        return ejecutarFwwPrueba(deps.complementarios, {
          canonica,
          resultadosUrl: typeof t.datos?.sourceUrl === 'string' ? t.datos.sourceUrl : null,
          urls: { poules: lista(t.datos?.poules), cuadro: lista(t.datos?.cuadro) },
        });
      }
      case 'enlaces_fie':
        return deps.enlaces ? ejecutarEnlaces(deps.enlaces, t) : error('Los enlaces no están configurados en este modo');
      default:
        return error(`Tipo de tarea desconocido: ${String((t as Tarea).tipo)}`);
    }
  };
}
