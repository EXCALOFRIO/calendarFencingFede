import { sql } from 'drizzle-orm';
import { bigint, check, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Reserva permanente de cada tarea/minuto UTC programado. No representa las
 * llamadas HTTP manuales. Una reserva fallida o sin cierre NO se libera:
 * repetir automáticamente puede duplicar escrituras parcialmente completadas.
 */
export const cronExecution = pgTable(
  'cron_execution',
  {
    task: text('task').notNull(),
    scheduledMinute: bigint('scheduled_minute', { mode: 'number' }).notNull(),
    status: text('status', { enum: ['reclamada', 'completada', 'fallida'] }).notNull().default('reclamada'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    httpStatus: integer('http_status'),
    /** Código cerrado, nunca un mensaje de excepción ni el cuerpo de la ruta. */
    failureCode: text('failure_code'),
  },
  (t) => [
    primaryKey({ name: 'cron_execution_task_minute_pk', columns: [t.task, t.scheduledMinute] }),
    check('cron_execution_minute_check', sql`${t.scheduledMinute} >= 0`),
    check('cron_execution_status_check', sql`${t.status} IN ('reclamada', 'completada', 'fallida')`),
    check('cron_execution_http_check', sql`${t.httpStatus} IS NULL OR ${t.httpStatus} BETWEEN 100 AND 599`),
    check(
      'cron_execution_failure_check',
      sql`${t.failureCode} IS NULL OR ${t.failureCode} IN ('http', 'resultado', 'respuesta_invalida', 'excepcion')`,
    ),
  ],
);
