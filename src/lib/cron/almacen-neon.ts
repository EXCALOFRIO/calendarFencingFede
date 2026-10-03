import type { AlmacenCron } from './programado';

export interface ConsultaCron {
  query(texto: string, parametros: unknown[]): Promise<unknown[]>;
}

/** SQL parametrizado: la clave lógica no contiene expresión, versión ni segundos. */
export function crearAlmacenCronSql(sql: ConsultaCron): AlmacenCron {
  return {
    async reclamar({ tarea, minutoUtc }) {
      const filas = await sql.query(
        `INSERT INTO "public"."cron_execution" ("task", "scheduled_minute")
         VALUES ($1, $2)
         ON CONFLICT ("task", "scheduled_minute") DO NOTHING
         RETURNING "task"`,
        [tarea, minutoUtc],
      );
      return filas.length === 1;
    },
    async cerrar({ tarea, minutoUtc }, { estado, httpStatus, motivo }) {
      const filas = await sql.query(
        `UPDATE "public"."cron_execution"
         SET "status" = $3, "finished_at" = now(), "http_status" = $4, "failure_code" = $5
         WHERE "task" = $1 AND "scheduled_minute" = $2 AND "status" = 'reclamada'
         RETURNING "task"`,
        [tarea, minutoUtc, estado, httpStatus, motivo],
      );
      if (filas.length !== 1) throw new Error('No se pudo registrar el cierre del cron.');
    },
  };
}

/**
 * El driver y la conexión se crean sólo para un scheduled configurado.
 * Recibe el binding del Worker: no importar @/db ni depender de process.env
 * antes de que OpenNext inicialice el entorno de la aplicación.
 */
export async function crearAlmacenCronNeon(databaseUrl: string): Promise<AlmacenCron> {
  const { neon } = await import('@neondatabase/serverless');
  return crearAlmacenCronSql(neon(databaseUrl));
}
