-- Los plazos de la RFEE no se cuentan en días, se anclan a un día de la semana
-- y a una hora de reloj: «el viernes de la semana anterior a la competición a
-- las 12:00 h» (Circular 12-26), «hasta el lunes anterior a las 23:59» y
-- «hasta el martes anterior a las 23:59» (Normativa de Rankings, 3.3.2).
--
-- Con `days_before` solo salía bien si la competición empezaba en sábado, y de
-- 28 competiciones nacionales 11 no empiezan en sábado.
ALTER TABLE "deadline_rule" ADD COLUMN "format" "competition_format";--> statement-breakpoint
ALTER TABLE "deadline_rule" ADD COLUMN "weekday" smallint;--> statement-breakpoint
ALTER TABLE "deadline_rule" ADD COLUMN "weeks_before" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deadline_rule" ADD COLUMN "time_of_day" text;--> statement-breakpoint
ALTER TABLE "deadline_rule" ADD CONSTRAINT "deadline_rule_weekday_iso"
  CHECK ("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7);--> statement-breakpoint
ALTER TABLE "deadline_rule" ADD CONSTRAINT "deadline_rule_time_of_day_hhmm"
  CHECK ("time_of_day" IS NULL OR "time_of_day" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
