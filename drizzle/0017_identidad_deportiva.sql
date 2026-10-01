-- Modelo deportivo independiente de la cuenta: persona, alias, IDs externos con
-- ámbito/vigencia, ediciones y pruebas, puestos, asaltos individuales,
-- publicaciones oficiales de ranking, favoritos y cobertura/checkpoints.
--
-- SOLO ADITIVA: crea 12 tablas `sport_*` y 2 enums. No altera, renombra ni borra
-- ninguna tabla o columna existente (`athlete`, `result`, `event`, rankings...);
-- las claves ajenas hacia ellas son de las nuevas tablas hacia las viejas.
-- `athlete.active` no se interpreta: la ficha enlazada es opcional.
--
-- Escrita a partir de `drizzle-kit export` sobre src/db/schema/sport.ts y hecha
-- idempotente (IF NOT EXISTS / duplicate_object) como el resto de migraciones
-- manuales; el journal de Drizzle y los snapshots ya iban por delante de 0007.
--
-- NO se ha aplicado a ninguna base. Revisar y aplicar a mano; el retorno está en
-- drizzle/manual/0017_identidad_deportiva.down.sql (solo borra tablas nuevas,
-- vacías hasta que se importe algo).
DO $$ BEGIN
  CREATE TYPE "public"."sport_coverage_status" AS ENUM('pendiente', 'completo', 'parcial', 'sin_resultados', 'error', 'conflicto');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."sport_link_status" AS ENUM('PROPUESTO', 'CONFIRMADO', 'RECHAZADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_bout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"source" text NOT NULL,
	"phase" text NOT NULL,
	"round_key" text NOT NULL,
	"fencer_a_ref" text NOT NULL,
	"fencer_b_ref" text NOT NULL,
	"fencer_a_person_id" uuid,
	"fencer_b_person_id" uuid,
	"fencer_a_name" text NOT NULL,
	"fencer_b_name" text NOT NULL,
	"score_a" smallint NOT NULL,
	"score_b" smallint NOT NULL,
	"occurred_on" date,
	"source_url" text,
	"content_hash" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revised_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_bout_key" UNIQUE("competition_id","source","phase","round_key","fencer_a_ref","fencer_b_ref"),
	CONSTRAINT "sport_bout_canonical_order" CHECK ("sport_bout"."fencer_a_ref" < "sport_bout"."fencer_b_ref"),
	CONSTRAINT "sport_bout_phase" CHECK ("sport_bout"."phase" IN ('POULE','TABLEAU')),
	CONSTRAINT "sport_bout_scores" CHECK ("sport_bout"."score_a" >= 0 AND "sport_bout"."score_b" >= 0),
	CONSTRAINT "sport_bout_distinct_people" CHECK ("sport_bout"."fencer_a_person_id" IS NULL OR "sport_bout"."fencer_b_person_id" IS NULL OR "sport_bout"."fencer_a_person_id" <> "sport_bout"."fencer_b_person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_competition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"source" text NOT NULL,
	"season" text NOT NULL,
	"competition_key" text NOT NULL,
	"weapon" "weapon" NOT NULL,
	"gender" "gender" NOT NULL,
	"category" "category_code" NOT NULL,
	"category_raw" text,
	"format" "competition_format" DEFAULT 'INDIVIDUAL' NOT NULL,
	"competition_date" date,
	"source_url" text,
	"event_competition_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_competition_key" UNIQUE("source","season","competition_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_edition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"season" text NOT NULL,
	"tournament_key" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"city" text,
	"country_code" text,
	"source_url" text,
	"event_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_edition_key" UNIQUE("source","season","tournament_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_external_id" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"scheme" text NOT NULL,
	"value" text NOT NULL,
	"scope_source" text NOT NULL,
	"scope_federation" text DEFAULT '' NOT NULL,
	"scope_season" text DEFAULT '' NOT NULL,
	"scope_weapon" text DEFAULT '' NOT NULL,
	"valid_from" date DEFAULT '1900-01-01' NOT NULL,
	"valid_to" date,
	"link_status" "sport_link_status" DEFAULT 'PROPUESTO' NOT NULL,
	"linked_via" text,
	"linked_at" timestamp with time zone,
	"evidence" text,
	"decided_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_external_id_person_key" UNIQUE("person_id","scheme","value","scope_source","scope_federation","scope_season","scope_weapon","valid_from"),
	CONSTRAINT "sport_external_id_confirmed_has_person" CHECK ("sport_external_id"."link_status" <> 'CONFIRMADO' OR "sport_external_id"."person_id" IS NOT NULL),
	CONSTRAINT "sport_external_id_validity" CHECK ("sport_external_id"."valid_to" IS NULL OR "sport_external_id"."valid_to" >= "sport_external_id"."valid_from"),
	CONSTRAINT "sport_external_id_scheme" CHECK ("sport_external_id"."scheme" IN ('fie_addr_id','fie_license','rfee_license','skermo_athlete_id','pdf_ref'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_favorite" (
	"profile_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_favorite_profile_id_person_id_pk" PRIMARY KEY("profile_id","person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_import_coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"season" text NOT NULL,
	"fact_kind" text NOT NULL,
	"competition_key" text DEFAULT '' NOT NULL,
	"competition_id" uuid,
	"status" "sport_coverage_status" DEFAULT 'pendiente' NOT NULL,
	"published_total" integer,
	"imported_total" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"source_url" text,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_import_coverage_key" UNIQUE("source","season","fact_kind","competition_key"),
	CONSTRAINT "sport_import_coverage_counts" CHECK ("sport_import_coverage"."imported_total" >= 0 AND "sport_import_coverage"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_link_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"source_name" text NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "sport_link_status" DEFAULT 'PROPUESTO' NOT NULL,
	"evidence" text,
	"decided_by_profile_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_link_candidate_key" UNIQUE("source","source_ref","person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid,
	"athlete_linked_via" text,
	"athlete_linked_at" timestamp with time zone,
	"athlete_link_evidence" text,
	"display_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"name_normalized" text NOT NULL,
	"gender" "gender",
	"country_code" text,
	"birth_year" smallint,
	"merged_into_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_person_no_self_merge" CHECK ("sport_person"."merged_into_person_id" IS DISTINCT FROM "sport_person"."id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_person_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"source" text NOT NULL,
	"name_original" text NOT NULL,
	"name_normalized" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_person_alias_key" UNIQUE("person_id","source","name_normalized")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_ranking_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"source_ref" text NOT NULL,
	"person_id" uuid,
	"source_name" text,
	"country_code" text,
	"position" integer,
	"points" numeric(10, 3),
	CONSTRAINT "sport_ranking_entry_key" UNIQUE("publication_id","source_ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_ranking_publication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"season" text NOT NULL,
	"weapon" "weapon" NOT NULL,
	"gender" "gender" NOT NULL,
	"category" "category_code" NOT NULL,
	"category_raw" text NOT NULL,
	"format" "competition_format" DEFAULT 'INDIVIDUAL' NOT NULL,
	"published_on" date NOT NULL,
	"source_url" text,
	"published_total" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_ranking_publication_key" UNIQUE("source","season","weapon","gender","category_raw","format","published_on")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sport_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_fact_key" text NOT NULL,
	"person_id" uuid,
	"source_name" text NOT NULL,
	"source_country_code" text,
	"source_club" text,
	"position" integer,
	"position_raw" text,
	"official_points" numeric(10, 3),
	"occurred_on" date,
	"source_url" text,
	"content_hash" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revised_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_result_key" UNIQUE("competition_id","source","source_fact_key"),
	CONSTRAINT "sport_result_position_positive" CHECK ("sport_result"."position" IS NULL OR "sport_result"."position" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_bout" ADD CONSTRAINT "sport_bout_competition_id_sport_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."sport_competition"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_bout" ADD CONSTRAINT "sport_bout_fencer_a_person_id_sport_person_id_fk" FOREIGN KEY ("fencer_a_person_id") REFERENCES "public"."sport_person"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_bout" ADD CONSTRAINT "sport_bout_fencer_b_person_id_sport_person_id_fk" FOREIGN KEY ("fencer_b_person_id") REFERENCES "public"."sport_person"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_competition" ADD CONSTRAINT "sport_competition_edition_id_sport_edition_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."sport_edition"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_competition" ADD CONSTRAINT "sport_competition_event_competition_id_event_competition_id_fk" FOREIGN KEY ("event_competition_id") REFERENCES "public"."event_competition"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_edition" ADD CONSTRAINT "sport_edition_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_external_id" ADD CONSTRAINT "sport_external_id_person_id_sport_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."sport_person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_external_id" ADD CONSTRAINT "sport_external_id_decided_by_profile_id_user_profile_id_fk" FOREIGN KEY ("decided_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_favorite" ADD CONSTRAINT "sport_favorite_profile_id_user_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_favorite" ADD CONSTRAINT "sport_favorite_person_id_sport_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."sport_person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_import_coverage" ADD CONSTRAINT "sport_import_coverage_competition_id_sport_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."sport_competition"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_link_candidate" ADD CONSTRAINT "sport_link_candidate_person_id_sport_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."sport_person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_link_candidate" ADD CONSTRAINT "sport_link_candidate_decided_by_profile_id_user_profile_id_fk" FOREIGN KEY ("decided_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_person" ADD CONSTRAINT "sport_person_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_person" ADD CONSTRAINT "sport_person_merged_into_person_id_sport_person_id_fk" FOREIGN KEY ("merged_into_person_id") REFERENCES "public"."sport_person"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_person_alias" ADD CONSTRAINT "sport_person_alias_person_id_sport_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."sport_person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_ranking_entry" ADD CONSTRAINT "sport_ranking_entry_publication_id_sport_ranking_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."sport_ranking_publication"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_ranking_entry" ADD CONSTRAINT "sport_ranking_entry_person_id_sport_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."sport_person"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_result" ADD CONSTRAINT "sport_result_competition_id_sport_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."sport_competition"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_result" ADD CONSTRAINT "sport_result_person_id_sport_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."sport_person"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_bout_a_idx" ON "sport_bout" USING btree ("fencer_a_person_id","fencer_b_person_id","occurred_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_bout_b_idx" ON "sport_bout" USING btree ("fencer_b_person_id","fencer_a_person_id","occurred_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_bout_competition_idx" ON "sport_bout" USING btree ("competition_id","phase","round_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_competition_edition_idx" ON "sport_competition" USING btree ("edition_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_competition_filter_idx" ON "sport_competition" USING btree ("weapon","gender","category","format","season");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_competition_date_idx" ON "sport_competition" USING btree ("competition_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_edition_dates_idx" ON "sport_edition" USING btree ("start_date","end_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_edition_event_idx" ON "sport_edition" USING btree ("event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sport_external_id_confirmed_key" ON "sport_external_id" USING btree ("scheme","value","scope_source","scope_federation","scope_season","scope_weapon","valid_from") WHERE "sport_external_id"."link_status" = 'CONFIRMADO';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_external_id_lookup_idx" ON "sport_external_id" USING btree ("scheme","value","scope_source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_external_id_person_idx" ON "sport_external_id" USING btree ("person_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_favorite_profile_idx" ON "sport_favorite" USING btree ("profile_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_favorite_person_idx" ON "sport_favorite" USING btree ("person_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_import_coverage_status_idx" ON "sport_import_coverage" USING btree ("status","source","season");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_import_coverage_competition_idx" ON "sport_import_coverage" USING btree ("competition_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_link_candidate_open_idx" ON "sport_link_candidate" USING btree ("status","source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_link_candidate_person_idx" ON "sport_link_candidate" USING btree ("person_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sport_person_athlete_key" ON "sport_person" USING btree ("athlete_id") WHERE "sport_person"."athlete_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_person_name_idx" ON "sport_person" USING btree ("name_normalized" text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_person_merged_idx" ON "sport_person" USING btree ("merged_into_person_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_person_alias_name_idx" ON "sport_person_alias" USING btree ("name_normalized" text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_ranking_entry_person_idx" ON "sport_ranking_entry" USING btree ("person_id","publication_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_ranking_entry_position_idx" ON "sport_ranking_entry" USING btree ("publication_id","position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_ranking_publication_lookup_idx" ON "sport_ranking_publication" USING btree ("season","weapon","gender","category","published_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_result_person_date_idx" ON "sport_result" USING btree ("person_id","occurred_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_result_competition_position_idx" ON "sport_result" USING btree ("competition_id","position");

