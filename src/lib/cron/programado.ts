import type { BaseCronD1 } from './almacen-d1';

/** Tipos mínimos de Workers: el manejador no depende de process.env ni de Next. */
export type EntornoCron = {
  DB?: BaseCronD1;
  CRON_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
};
export type DisparoCron = { readonly cron: string; readonly scheduledTime: number };
export type ContextoCron = { waitUntil(promesa: Promise<unknown>): void };
export type FetchCron = (
  peticion: Request,
  entorno: EntornoCron,
  contexto: ContextoCron,
) => Promise<Response>;

/** Las expresiones deben coincidir literalmente con triggers.crons. */
export const TAREAS_CRON: Readonly<Record<string, string>> = Object.freeze({
  '0 3 * * *': '/api/cron/ingest/skermo_rfee',
  '30 3 * * *': '/api/cron/ingest/fie',
  '0 4 * * *': '/api/cron/ingest/efc',
  '30 4 * * *': '/api/cron/ingest/skermo_regional',
  '0 5 * * *': '/api/cron/ingest/rfee_wp',
  '30 5 * * *': '/api/cron/ingest/skermo_ranking',
  // Después de descubrir las circulares; las fichas FIE cierran las ingestiones.
  '0 6 * * *': '/api/cron/extraer',
  '45 6 * * *': '/api/cron/ingest/fie_tiradores',
  '0 7 * * *': '/api/cron/notify',
  // `/api/cron/sport` (incremento antiguo) no tiene franja a propósito: lo sustituye
  // `/api/cron/resultados` para los resultados. Ver docs/tareas-programadas.md.
  // Resultados automáticos; fuera de triggers.crons y apagado hasta activarlo.
  // Evita la franja 03:00-07:59 de las ingestiones diarias.
  '20 0-2,8-23 * * *': '/api/cron/resultados',
});

export type ReservaCron = { tarea: string; minutoUtc: number };
export type MotivoFalloCron = 'http' | 'resultado' | 'respuesta_invalida' | 'excepcion';
export type CierreCron = {
  estado: 'completada' | 'fallida';
  httpStatus: number | null;
  motivo: MotivoFalloCron | null;
};
export interface AlmacenCron {
  reclamar(reserva: ReservaCron): Promise<boolean>;
  cerrar(reserva: ReservaCron, cierre: CierreCron): Promise<void>;
}
type RegistroCron = Pick<Console, 'log' | 'warn' | 'error'>;
export type DependenciasCron = {
  servir: FetchCron;
  crearAlmacen(base: BaseCronD1): Promise<AlmacenCron>;
  registro?: RegistroCron;
};

/**
 * Franja UTC de Cloudflare, no el reloj del dispatch. :04 y :56 de un mismo
 * minuto comparten clave, incluso si un reintento llega al día siguiente.
 */
export function normalizarMinutoProgramado(scheduledTime: number): number {
  if (!Number.isSafeInteger(scheduledTime) || scheduledTime < 0) {
    throw new Error('scheduledTime no es un instante válido.');
  }
  return Math.floor(scheduledTime / 60_000);
}

/**
 * text() espera hasta el EOF también si OpenNext entrega un ReadableStream.
 * La ruta de ingestión actual devuelve JSON { ok, status } y conserva 200
 * incluso en error: no basta con response.ok. Un parcial sigue siendo parcial
 * en ingest_run, pero no un fallo total del cron. Nunca se almacena el cuerpo.
 */
export async function consumirRespuestaCron(respuesta: Response): Promise<CierreCron> {
  const cuerpo = await respuesta.text();
  const cierre = (motivo: MotivoFalloCron | null): CierreCron => ({
    estado: motivo ? 'fallida' : 'completada',
    httpStatus: respuesta.status,
    motivo,
  });
  if (!respuesta.ok) return cierre('http');
  let resultado: unknown;
  try {
    resultado = JSON.parse(cuerpo);
  } catch {
    return cierre('respuesta_invalida');
  }
  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado)) {
    return cierre('respuesta_invalida');
  }
  const resumen = resultado as { ok?: unknown; status?: unknown };
  if (resumen.ok === false || resumen.status === 'error') return cierre('resultado');
  return cierre(resumen.ok === true ? null : 'respuesta_invalida');
}

export function crearManejadorProgramado(dependencias: DependenciasCron) {
  const registro = dependencias.registro ?? console;
  return async (disparo: DisparoCron, entorno: EntornoCron, contexto: ContextoCron) => {
    // No leer claves heredadas de Object.prototype como si fueran rutas.
    const tarea = Object.hasOwn(TAREAS_CRON, disparo.cron) ? TAREAS_CRON[disparo.cron] : undefined;
    if (!tarea) {
      registro.warn('[cron] Expresión sin tarea asignada; no se ejecuta.');
      return;
    }
    if (!entorno.DB || typeof entorno.DB.prepare !== 'function' || !entorno.CRON_SECRET?.trim()) {
      registro.error(`[cron] ${tarea}: falta DB o CRON_SECRET; no se ejecuta.`);
      return;
    }
    let reserva: ReservaCron;
    try {
      reserva = { tarea, minutoUtc: normalizarMinutoProgramado(disparo.scheduledTime) };
    } catch {
      registro.error(`[cron] ${tarea}: instante programado inválido; no se ejecuta.`);
      return;
    }

    let almacen: AlmacenCron;
    try {
      almacen = await dependencias.crearAlmacen(entorno.DB);
      if (!(await almacen.reclamar(reserva))) {
        registro.log(`[cron] ${tarea} minuto=${reserva.minutoUtc}: duplicado omitido.`);
        return;
      }
    } catch {
      // Una respuesta perdida del INSERT puede haber dejado la reserva escrita.
      // No despachar ni liberar nada: el trabajo puede no ser idempotente.
      registro.error(`[cron] ${tarea}: no se pudo reclamar la franja; no se ejecuta.`);
      return;
    }

    let cierre: CierreCron = { estado: 'fallida', httpStatus: null, motivo: 'excepcion' };
    try {
      const base = entorno.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || 'https://localhost';
      const respuesta = await dependencias.servir(
        new Request(`${base}${tarea}`, {
          method: 'GET',
          headers: {
            'user-agent': 'cloudflare-cron/1.0',
            authorization: `Bearer ${entorno.CRON_SECRET}`,
          },
        }),
        entorno,
        contexto,
      );
      cierre.httpStatus = respuesta.status;
      cierre = await consumirRespuestaCron(respuesta);
    } catch {
      // No registrar mensajes de excepción: podrían incluir credenciales o datos.
    }

    try {
      await almacen.cerrar(reserva, cierre);
      registro.log(
        `[cron] ${tarea} minuto=${reserva.minutoUtc}: ${cierre.estado} ` +
          `http=${cierre.httpStatus ?? '-'} motivo=${cierre.motivo ?? '-'}.`,
      );
    } catch {
      registro.error(`[cron] ${tarea}: no se pudo registrar el cierre; la reserva se conserva.`);
    }
    // Nunca DELETE, caducidad ni reintento automático tras escrituras parciales.
    // Un corte del Worker deja estado reclamada; también bloquea los duplicados.
  };
}
