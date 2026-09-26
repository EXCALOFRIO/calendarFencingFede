CREATE TYPE "public"."fie_link_status" AS ENUM('PROPUESTO', 'CONFIRMADO', 'RECHAZADO');--> statement-breakpoint
CREATE TYPE "public"."certeza_evento_extraccion" AS ENUM('seguro', 'dudoso', 'desconocido');--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'fie_tiradores';--> statement-breakpoint
CREATE TABLE "fie_fencer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fie_id" integer NOT NULL,
	"athlete_id" uuid,
	"proposed_athlete_id" uuid,
	"link_status" "fie_link_status" DEFAULT 'PROPUESTO' NOT NULL,
	"linked_via" text,
	"linked_at" timestamp with time zone,
	"match_evidence" text,
	"source_name" text NOT NULL,
	"source_first_name" text,
	"source_last_name" text,
	"country_code" text,
	"source_birth_date" date,
	"hand" text,
	"photo_url" text,
	"profile_url" text NOT NULL,
	"fie_license" text,
	"fie_license_status" text,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fie_fencer_key" UNIQUE("fie_id")
);
--> statement-breakpoint
CREATE TABLE "fie_world_ranking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fie_id" integer NOT NULL,
	"season" integer NOT NULL,
	"weapon" "weapon" NOT NULL,
	"gender" "gender" NOT NULL,
	"category" "category_code" NOT NULL,
	"category_raw" text NOT NULL,
	"age_band" text,
	"position" integer,
	"points" numeric(10, 3),
	"event_count" integer,
	"source_url" text,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fie_world_ranking_key" UNIQUE("fie_id","season","weapon","gender","category_raw")
);
--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD COLUMN "evento_documento_id" uuid;--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD COLUMN "evento_id" uuid;--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD COLUMN "evento_certeza" "certeza_evento_extraccion";--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD COLUMN "evento_motivo" text;--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD COLUMN "evento_confirmado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD COLUMN "evento_confirmado_por_perfil_id" uuid;--> statement-breakpoint
ALTER TABLE "extraccion_propuesta" ADD COLUMN "evento_id" uuid;--> statement-breakpoint
ALTER TABLE "extraccion_propuesta" ADD COLUMN "prueba" text;--> statement-breakpoint
ALTER TABLE "fie_fencer" ADD CONSTRAINT "fie_fencer_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fie_fencer" ADD CONSTRAINT "fie_fencer_proposed_athlete_id_athlete_id_fk" FOREIGN KEY ("proposed_athlete_id") REFERENCES "public"."athlete"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fie_fencer_athlete_idx" ON "fie_fencer" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "fie_fencer_pendiente_idx" ON "fie_fencer" USING btree ("link_status","proposed_athlete_id");--> statement-breakpoint
CREATE INDEX "fie_world_ranking_fencer_idx" ON "fie_world_ranking" USING btree ("fie_id","season");--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD CONSTRAINT "extraccion_documento_evento_documento_id_event_document_id_fk" FOREIGN KEY ("evento_documento_id") REFERENCES "public"."event_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD CONSTRAINT "extraccion_documento_evento_id_event_id_fk" FOREIGN KEY ("evento_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD CONSTRAINT "extraccion_documento_evento_confirmado_por_perfil_id_user_profile_id_fk" FOREIGN KEY ("evento_confirmado_por_perfil_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraccion_propuesta" ADD CONSTRAINT "extraccion_propuesta_evento_id_event_id_fk" FOREIGN KEY ("evento_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extraccion_documento_evento_doc_idx" ON "extraccion_documento" USING btree ("evento_documento_id");--> statement-breakpoint
CREATE INDEX "extraccion_documento_evento_idx" ON "extraccion_documento" USING btree ("evento_id");--> statement-breakpoint
CREATE INDEX "extraccion_propuesta_evento_idx" ON "extraccion_propuesta" USING btree ("evento_id","estado");