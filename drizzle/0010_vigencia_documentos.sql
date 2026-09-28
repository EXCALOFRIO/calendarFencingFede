-- Vigencia de las circulares: qué manda, qué está superado y qué se canceló.
--
-- La tabla es DERIVADA: se recalcula entera a partir de los títulos y las
-- fechas de `official_document`, así que se puede vaciar sin perder nada.
-- Va aparte y no como columnas de `official_document` para no mezclar la copia
-- fiel de lo que publica la RFEE con lo que deducimos nosotros.
CREATE TYPE "public"."estado_vigencia_documento" AS ENUM('vigente', 'superada', 'cancelada', 'duplicada');--> statement-breakpoint
CREATE TABLE "documento_vigencia" (
	"documento_id" uuid PRIMARY KEY NOT NULL,
	"familia" text NOT NULL,
	"asunto" text NOT NULL,
	"temporada" text,
	"temporada_inferida" boolean DEFAULT false NOT NULL,
	"numero_circular" text,
	"etiqueta_version" text,
	"orden_version" integer DEFAULT 100 NOT NULL,
	"versiones_en_familia" integer DEFAULT 1 NOT NULL,
	"estado" "estado_vigencia_documento" NOT NULL,
	"sustituida_por_id" uuid,
	"duplicado_de_id" uuid,
	"motivo" text,
	"hash_intentado_en" timestamp with time zone,
	"hash_error" text,
	"calculado_en" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "documento_vigencia" ADD CONSTRAINT "documento_vigencia_documento_id_official_document_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."official_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_vigencia" ADD CONSTRAINT "documento_vigencia_sustituida_por_id_official_document_id_fk" FOREIGN KEY ("sustituida_por_id") REFERENCES "public"."official_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_vigencia" ADD CONSTRAINT "documento_vigencia_duplicado_de_id_official_document_id_fk" FOREIGN KEY ("duplicado_de_id") REFERENCES "public"."official_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documento_vigencia_estado_idx" ON "documento_vigencia" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "documento_vigencia_familia_idx" ON "documento_vigencia" USING btree ("familia");--> statement-breakpoint
CREATE INDEX "documento_vigencia_intento_idx" ON "documento_vigencia" USING btree ("hash_intentado_en");--> statement-breakpoint
-- Índice para la consulta de pendientes de hashear: `file_hash IS NULL`.
-- Parcial a propósito: cuando la pasada acabe, el índice pesará casi nada.
CREATE INDEX "official_document_sin_hash_idx" ON "official_document" USING btree ("id") WHERE "official_document"."file_hash" IS NULL;--> statement-breakpoint
-- Fórmula de puntos y arrastre de la temporada anterior: los dos números que
-- la «NORMATIVA PARA RANKINGS NACIONALES_26-27_V1» usa y que no cabían en
-- `points_table` ni en `coefficients`.
ALTER TABLE "ranking_rule" ADD COLUMN "points_formula" jsonb;--> statement-breakpoint
ALTER TABLE "ranking_rule" ADD COLUMN "previous_season_carry" numeric(5, 4);
