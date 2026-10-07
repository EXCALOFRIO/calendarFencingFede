/**
 * Lo que sigue a cada pasada de ingesta (cron de resultados automáticos, cron
 * y panel de `runIngest`): generar y empujar los avisos de resultados nuevos y
 * subir la época de la caché compartida de lo que esa fuente cambia.
 *
 * Nunca lanza: si falla un paso, los datos ya están escritos y la ingesta tiene
 * que contar como hecha. Los avisos que no salgan ahora los recoge el cron
 * diario (`/api/cron/notify`), y la caché caduca sola por tiempo.
 *
 * El resumen solo lleva recuentos: ni personas, ni perfiles, ni mensajes de
 * excepción (pueden llevar SQL o datos de la fuente).
 */
import type { DbAvisos } from '@/lib/notificaciones/db';

export type EstadoAvisos =
  | { estado: 'ok'; eventos: number; avisos: number; push: number }
  | { estado: 'sin_tablas' | 'error' };

export type ResumenTrasIngesta = { avisos: EstadoAvisos; cache: 'ok' | 'error' | 'sin_cambios' };

type ResumenNotificar = { eventos: number; avisos: number; push: { enviadas: number } };

export type DepsTrasIngesta = {
  db?: DbAvisos;
  notificar?: (db: DbAvisos) => Promise<ResumenNotificar>;
  invalidar?: (fuente: string) => Promise<void>;
  registro?: Pick<Console, 'warn'>;
  /**
   * El resultado de `runIngest`. Si dice `sinCambios`, la época de la caché no
   * se sube: hacerlo vaciaría la caché compartida del calendario sin motivo.
   */
  resultado?: { sinCambios?: boolean };
};

async function obtenerDb(deps: DepsTrasIngesta): Promise<DbAvisos> {
  if (deps.db) return deps.db;
  return (await import('@/db')).db;
}

export async function trasIngesta(fuente: string, deps: DepsTrasIngesta = {}): Promise<ResumenTrasIngesta> {
  const registro = deps.registro ?? console;
  const resumen: ResumenTrasIngesta = { avisos: { estado: 'error' }, cache: 'ok' };

  try {
    if (deps.resultado?.sinCambios === true) {
      resumen.cache = 'sin_cambios';
    } else {
      const invalidar = deps.invalidar ?? (await import('@/lib/cache')).invalidarTrasIngesta;
      await invalidar(fuente);
    }
  } catch (error) {
    resumen.cache = 'error';
    registro.warn(`[tras-ingesta] ${fuente}: no se pudo invalidar la caché (${nombreDeError(error)})`);
  }

  try {
    const db = await obtenerDb(deps);
    const notificar = deps.notificar ?? (await import('@/lib/notificaciones/resultados')).notificarResultadosNuevos;
    const r = await notificar(db);
    resumen.avisos = { estado: 'ok', eventos: r.eventos, avisos: r.avisos, push: r.push.enviadas };
  } catch (error) {
    const { esFaltaDeTabla } = await import('@/lib/notificaciones/db');
    if (esFaltaDeTabla(error)) {
      resumen.avisos = { estado: 'sin_tablas' };
    } else {
      resumen.avisos = { estado: 'error' };
      registro.warn(`[tras-ingesta] ${fuente}: no se pudieron generar los avisos (${nombreDeError(error)})`);
    }
  }

  return resumen;
}

function nombreDeError(error: unknown): string {
  return error instanceof Error ? error.name : 'desconocido';
}
