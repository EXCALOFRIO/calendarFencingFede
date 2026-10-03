import type { AlmacenCron } from './programado';

type ValorCron = string | number | null;

export interface SentenciaCronD1 {
  bind(...valores: ValorCron[]): SentenciaCronD1;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[]; success: boolean }>;
}

export interface BaseCronD1 {
  prepare(texto: string): SentenciaCronD1;
}

export interface ConsultaCron {
  query(texto: string, parametros: ValorCron[]): Promise<unknown[]>;
}

/** La reserva única permanece incluso si la ejecución o su respuesta se corta. */
export function crearAlmacenCronSql(base: ConsultaCron): AlmacenCron {
  return {
    async reclamar({ tarea, minutoUtc }) {
      const filas = await base.query(
        `INSERT INTO "cron_execution" ("task", "scheduled_minute")
         VALUES (?1, ?2)
         ON CONFLICT ("task", "scheduled_minute") DO NOTHING
         RETURNING "task"`,
        [tarea, minutoUtc],
      );
      return filas.length === 1;
    },
    async cerrar({ tarea, minutoUtc }, { estado, httpStatus, motivo }) {
      const filas = await base.query(
        `UPDATE "cron_execution"
         SET "status" = ?3,
             "finished_at" = cast(round((julianday('now') - 2440587.5) * 86400000) as integer),
             "http_status" = ?4, "failure_code" = ?5
         WHERE "task" = ?1 AND "scheduled_minute" = ?2 AND "status" = 'reclamada'
         RETURNING "task"`,
        [tarea, minutoUtc, estado, httpStatus, motivo],
      );
      if (filas.length !== 1) throw new Error('No se pudo registrar el cierre del cron.');
    },
  };
}

/** Recibe el binding directamente, antes de inicializar el entorno de OpenNext. */
export async function crearAlmacenCronD1(base: BaseCronD1): Promise<AlmacenCron> {
  if (!base || typeof base.prepare !== 'function') {
    throw new Error('Falta el binding DB de D1.');
  }
  return crearAlmacenCronSql({
    async query(texto, parametros) {
      const resultado = await base.prepare(texto).bind(...parametros).all();
      if (!resultado.success || !Array.isArray(resultado.results)) {
        throw new Error('D1 no confirmó la operación del cron.');
      }
      return resultado.results;
    },
  });
}
