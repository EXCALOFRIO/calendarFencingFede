-- Sólo añade la guarda de crons. No modifica datos ni tablas existentes.
-- La clave es la tarea lógica y floor(scheduledTime / 60000), nunca el segundo.
CREATE TABLE "public"."cron_execution" (
  "task" text NOT NULL,
  "scheduled_minute" bigint NOT NULL,
  "status" text DEFAULT 'reclamada' NOT NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "http_status" integer,
  "failure_code" text,
  CONSTRAINT "cron_execution_task_minute_pk" PRIMARY KEY ("task", "scheduled_minute"),
  CONSTRAINT "cron_execution_minute_check" CHECK ("scheduled_minute" >= 0),
  CONSTRAINT "cron_execution_status_check" CHECK ("status" IN ('reclamada', 'completada', 'fallida')),
  CONSTRAINT "cron_execution_http_check" CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599),
  CONSTRAINT "cron_execution_failure_check" CHECK ("failure_code" IS NULL OR "failure_code" IN ('http', 'resultado', 'respuesta_invalida', 'excepcion'))
);
