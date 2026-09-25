CREATE TYPE "public"."estado_extraccion" AS ENUM('ok', 'sin_texto', 'bloqueado_datos_personales', 'sin_modelo', 'error');--> statement-breakpoint
CREATE TYPE "public"."estado_propuesta_ia" AS ENUM('pendiente', 'aprobada', 'rechazada');--> statement-breakpoint
CREATE TYPE "public"."origen_texto_extraccion" AS ENUM('unpdf', 'ocr_modelo');--> statement-breakpoint
ALTER TYPE "public"."event_source" ADD VALUE 'skermo_ranking';--> statement-breakpoint
CREATE TABLE "competition_registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_competition_id" uuid NOT NULL,
	"athlete_id" uuid,
	"source_athlete_name" text NOT NULL,
	"source_team" text DEFAULT '' NOT NULL,
	"source_license" text,
	"source_club" text,
	"source" "event_source" NOT NULL,
	"source_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "competition_registration_key" UNIQUE("event_competition_id","source_athlete_name","source_team")
);
--> statement-breakpoint
CREATE TABLE "official_ranking_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_label" text NOT NULL,
	"skermo_season_id" text NOT NULL,
	"weapon" "weapon" NOT NULL,
	"gender" "gender" NOT NULL,
	"category" "category_code" NOT NULL,
	"category_raw" text NOT NULL,
	"position" integer NOT NULL,
	"total_points" numeric(10, 2),
	"athlete_id" uuid,
	"skermo_athlete_id" text,
	"source_license" text,
	"source_athlete_name" text NOT NULL,
	"source_first_name" text,
	"source_last_name" text,
	"source_club" text,
	"source_birth_date" date,
	"source_url" text,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_ranking_entry_key" UNIQUE("skermo_season_id","weapon","gender","category_raw","position")
);
--> statement-breakpoint
CREATE TABLE "extraccion_documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid,
	"documento_url" text NOT NULL,
	"documento_titulo" text,
	"hash_documento" text NOT NULL,
	"hash_prompt" text NOT NULL,
	"version_esquema" integer NOT NULL,
	"estado" "estado_extraccion" NOT NULL,
	"motivo" text,
	"modelo" text,
	"origen_texto" "origen_texto_extraccion",
	"paginas" integer,
	"caracteres_texto" integer,
	"propuesta_json" jsonb,
	"descartadas_json" jsonb,
	"campos_propuestos" integer DEFAULT 0 NOT NULL,
	"campos_descartados" integer DEFAULT 0 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraccion_documento_clave" UNIQUE("hash_documento","hash_prompt","version_esquema")
);
--> statement-breakpoint
CREATE TABLE "extraccion_propuesta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraccion_id" uuid NOT NULL,
	"documento_id" uuid,
	"hash_documento" text NOT NULL,
	"campo" text NOT NULL,
	"valor_propuesto" text NOT NULL,
	"cita" text NOT NULL,
	"cita_verificada" boolean DEFAULT false NOT NULL,
	"contexto" text,
	"estado" "estado_propuesta_ia" DEFAULT 'pendiente' NOT NULL,
	"revisado_por_perfil_id" uuid,
	"revisado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraccion_propuesta_clave" UNIQUE("extraccion_id","campo")
);
--> statement-breakpoint
ALTER TABLE "competition_registration" ADD CONSTRAINT "competition_registration_event_competition_id_event_competition_id_fk" FOREIGN KEY ("event_competition_id") REFERENCES "public"."event_competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_registration" ADD CONSTRAINT "competition_registration_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_ranking_entry" ADD CONSTRAINT "official_ranking_entry_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraccion_documento" ADD CONSTRAINT "extraccion_documento_documento_id_official_document_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."official_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraccion_propuesta" ADD CONSTRAINT "extraccion_propuesta_extraccion_id_extraccion_documento_id_fk" FOREIGN KEY ("extraccion_id") REFERENCES "public"."extraccion_documento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraccion_propuesta" ADD CONSTRAINT "extraccion_propuesta_documento_id_official_document_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."official_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraccion_propuesta" ADD CONSTRAINT "extraccion_propuesta_revisado_por_perfil_id_user_profile_id_fk" FOREIGN KEY ("revisado_por_perfil_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_registration_competition_idx" ON "competition_registration" USING btree ("event_competition_id");--> statement-breakpoint
CREATE INDEX "competition_registration_athlete_idx" ON "competition_registration" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "official_ranking_entry_lookup_idx" ON "official_ranking_entry" USING btree ("season_label","weapon","gender","category");--> statement-breakpoint
CREATE INDEX "official_ranking_entry_athlete_idx" ON "official_ranking_entry" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "official_ranking_entry_skermo_idx" ON "official_ranking_entry" USING btree ("skermo_athlete_id");--> statement-breakpoint
CREATE INDEX "extraccion_documento_doc_idx" ON "extraccion_documento" USING btree ("documento_id");--> statement-breakpoint
CREATE INDEX "extraccion_documento_estado_idx" ON "extraccion_documento" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "extraccion_propuesta_estado_idx" ON "extraccion_propuesta" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "extraccion_propuesta_doc_idx" ON "extraccion_propuesta" USING btree ("documento_id");