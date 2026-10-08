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
import { sql } from 'drizzle-orm';
import { dependenciasDeFuente } from '@/lib/cache/invalidar';
import type { Dependencia } from '@/lib/cache/versiones';
import { filasDe, type DbAvisos } from '@/lib/notificaciones/db';

export type EstadoAvisos =
  | { estado: 'ok'; eventos: number; avisos: number; push: number }
  | { estado: 'sin_tablas' | 'error' };

export type ResumenTrasIngesta = { avisos: EstadoAvisos; cache: 'ok' | 'error' | 'sin_cambios' | 'aplazada' };

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
  /**
   * Pasada de la cadena nocturna del cron: la invalidación de cada familia se
   * aplaza hasta la última fuente de la cadena que la toca (`CIERRE_NOCTURNO`).
   * Sin esto (panel de admin, CLI, `?forzar=1`) se invalida en el acto.
   */
  cadena?: boolean;
  /** Para las pruebas: invalidación por familias, en vez de por fuente. */
  invalidarFamilias?: (deps: readonly Dependencia[]) => Promise<void>;
};

/**
 * ===========================================================================
 * UNA INVALIDACIÓN POR FAMILIA Y NOCHE
 * ===========================================================================
 *
 * Cada invalidación hace que los siguientes visitantes lean en frío (un perfil
 * frío son ~108.000 filas leídas). La cadena nocturna (`TAREAS_CRON`) tocaba
 * `calendario` hasta cinco veces entre las 03:00 y las 05:00. Ahora cada
 * fuente que cambia algo deja su familia PENDIENTE en `refresco_programado`
 * (tarea `cache_pendiente`), y la última fuente de la cadena que la toca la
 * invalida una sola vez, con lo de todas las anteriores. Si esa fuente no
 * llegara a correr, cualquier pasada posterior de la cadena invalida lo
 * pendiente con más de `PENDIENTE_MAX_MS`; mientras tanto la caché sigue
 * revalidándose sola por `frescoMs`.
 */
export const ORDEN_NOCTURNO = [
  'skermo_rfee',
  'fie',
  'efc',
  'skermo_regional',
  'rfee_wp',
  'skermo_ranking',
  'fie_tiradores',
] as const;
export const CIERRE_NOCTURNO: Readonly<Record<Dependencia, (typeof ORDEN_NOCTURNO)[number]>> = {
  calendario: 'rfee_wp',
  ranking: 'skermo_ranking',
  'ranking-fie': 'fie_tiradores',
  deporte: 'fie_tiradores',
};
export const PENDIENTE_MAX_MS = 12 * 3_600_000;
const TAREA_PENDIENTE = 'cache_pendiente';

export type PlanInvalidacion = { ahora: Dependencia[]; aplazar: Dependencia[]; limpiar: Dependencia[] };

/** Qué se invalida ya y qué se deja pendiente. Pura. */
export function planInvalidacion(
  fuente: string,
  cambiadas: readonly Dependencia[],
  pendientes: ReadonlyMap<Dependencia, number>,
  instante: number,
): PlanInvalidacion {
  const posicion = (ORDEN_NOCTURNO as readonly string[]).indexOf(fuente);
  const plan: PlanInvalidacion = { ahora: [], aplazar: [], limpiar: [] };
  const todas = new Set<Dependencia>([...cambiadas, ...pendientes.keys()]);
  for (const d of todas) {
    const pendienteDesde = pendientes.get(d);
    const cierre = ORDEN_NOCTURNO.indexOf(CIERRE_NOCTURNO[d]);
    const vieja = pendienteDesde !== undefined && instante - pendienteDesde > PENDIENTE_MAX_MS;
    if (posicion < 0 || posicion >= cierre || vieja) {
      plan.ahora.push(d);
      if (pendienteDesde !== undefined) plan.limpiar.push(d);
    } else if (cambiadas.includes(d) && pendienteDesde === undefined) {
      plan.aplazar.push(d);
    }
  }
  return plan;
}

async function leerPendientes(db: DbAvisos): Promise<Map<Dependencia, number>> {
  const filas = await filasDe<{ clave: string; desde: number }>(db, sql`
    SELECT clave, ultima_lectura AS desde FROM refresco_programado WHERE tarea = ${TAREA_PENDIENTE}`);
  return new Map(filas.map((f) => [f.clave as Dependencia, Number(f.desde)]));
}

async function invalidarEnCadena(
  fuente: string,
  deps: DepsTrasIngesta,
  db: DbAvisos,
  invalidarFamilias: (d: readonly Dependencia[]) => Promise<void>,
): Promise<'ok' | 'sin_cambios' | 'aplazada'> {
  const instante = Date.now();
  const cambiadas = deps.resultado?.sinCambios === true ? [] : [...dependenciasDeFuente(fuente)];
  let pendientes: Map<Dependencia, number>;
  try {
    pendientes = await leerPendientes(db);
  } catch {
    // Sin la tabla no se puede aplazar: se invalida como antes.
    if (cambiadas.length === 0) return 'sin_cambios';
    await invalidarFamilias(cambiadas);
    return 'ok';
  }
  const plan = planInvalidacion(fuente, cambiadas, pendientes, instante);
  if (plan.aplazar.length > 0) {
    await db.execute(sql`
      INSERT INTO refresco_programado (tarea, clave, ultima_lectura)
      SELECT ${TAREA_PENDIENTE}, value, ${instante} FROM json_each(${JSON.stringify(plan.aplazar)})
      WHERE true
      ON CONFLICT (tarea, clave) DO NOTHING`);
  }
  if (plan.ahora.length > 0) await invalidarFamilias(plan.ahora);
  // Después de invalidar: si la invalidación falla, lo pendiente sigue pendiente.
  if (plan.limpiar.length > 0) {
    await db.execute(sql`
      DELETE FROM refresco_programado WHERE tarea = ${TAREA_PENDIENTE}
        AND clave IN (SELECT value FROM json_each(${JSON.stringify(plan.limpiar)}))`);
  }
  if (plan.ahora.length > 0) return 'ok';
  return plan.aplazar.length > 0 || cambiadas.length > 0 ? 'aplazada' : 'sin_cambios';
}

async function obtenerDb(deps: DepsTrasIngesta): Promise<DbAvisos> {
  if (deps.db) return deps.db;
  return (await import('@/db')).db;
}

export async function trasIngesta(fuente: string, deps: DepsTrasIngesta = {}): Promise<ResumenTrasIngesta> {
  const registro = deps.registro ?? console;
  const resumen: ResumenTrasIngesta = { avisos: { estado: 'error' }, cache: 'ok' };

  try {
    if (deps.cadena) {
      const invalidarFamilias =
        deps.invalidarFamilias ?? (await import('@/lib/cache')).invalidarCache;
      resumen.cache = await invalidarEnCadena(fuente, deps, await obtenerDb(deps), invalidarFamilias);
    } else if (deps.resultado?.sinCambios === true) {
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
