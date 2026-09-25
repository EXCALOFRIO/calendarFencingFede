CREATE TYPE "public"."call_up_athlete_status" AS ENUM('pendiente', 'confirmado', 'rechazado');--> statement-breakpoint
CREATE TYPE "public"."category_code" AS ENUM('M9', 'M11', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET');--> statement-breakpoint
CREATE TYPE "public"."circuit" AS ENUM('TNR', 'LIGA_ORO', 'LIGA_PLATA', 'LIGA_IBERDROLA', 'LIGA_CLUBES', 'CTO_ESPANA', 'CONCENTRACION', 'SATELITE', 'FIE_CIRCUITO', 'ECC', 'U14_EFC', 'SUB23_EFC', 'EFC_LEAGUE', 'EUV', 'CAD_WC', 'JUN_WC', 'SEN_WC', 'SEN_GP', 'CTO_EUROPA', 'CTO_MUNDO', 'TLM', 'OTRO');--> statement-breakpoint
CREATE TYPE "public"."deadline_origin" AS ENUM('PUBLICADO', 'CALCULADO');--> statement-breakpoint
CREATE TYPE "public"."deadline_type" AS ENUM('L1', 'L2', 'L3', 'FIE_D7');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('draft', 'pending_club', 'club_approved', 'federation_approved', 'submitted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."competition_format" AS ENUM('INDIVIDUAL', 'EQUIPOS');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('M', 'F', 'MIXTO');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('ok', 'parcial', 'error');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pendiente', 'aceptada', 'revocada');--> statement-breakpoint
CREATE TYPE "public"."place_type" AS ENUM('ranking', 'tecnica');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pendiente', 'aprobada', 'descartada');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'club', 'athlete', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."competition_scope" AS ENUM('NACIONAL', 'INTERNACIONAL', 'AUTONOMICO');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('skermo_rfee', 'skermo_regional', 'fie', 'efc', 'rfee_wp');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('dry_run', 'sent', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."weapon" AS ENUM('FLORETE', 'ESPADA', 'SABLE');--> statement-breakpoint
CREATE TABLE "athlete" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_profile_id" uuid,
	"guardian_profile_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"gender" "gender" NOT NULL,
	"club_id" uuid,
	"rfee_license" text,
	"fie_license" text,
	"fie_license_valid_until" date,
	"rfee_license_valid_until" date,
	"consent_signed_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_rfee_license_key" UNIQUE("rfee_license")
);
--> statement-breakpoint
CREATE TABLE "athlete_weapon" (
	"athlete_id" uuid NOT NULL,
	"weapon" "weapon" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "athlete_weapon_athlete_id_weapon_pk" PRIMARY KEY("athlete_id","weapon")
);
--> statement-breakpoint
CREATE TABLE "club" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"regional_federation" text,
	"contact_email" text,
	"skermo_club_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "season_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "season_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"code" "category_code" NOT NULL,
	"birth_year_min" smallint,
	"birth_year_max" smallint,
	"rank" integer NOT NULL,
	"is_laddered" boolean DEFAULT true NOT NULL,
	"source_document" text,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_profile_id" uuid,
	CONSTRAINT "season_category_key" UNIQUE("season_id","code")
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'athlete' NOT NULL,
	"club_id" uuid,
	"phone" text,
	"invite_status" "invite_status" DEFAULT 'pendiente' NOT NULL,
	"invited_at" timestamp with time zone,
	"ical_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "user_profile_email_unique" UNIQUE("email"),
	CONSTRAINT "user_profile_ical_token_unique" UNIQUE("ical_token")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "event_source" NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"venue" text,
	"city" text,
	"country" text,
	"venue_address" text,
	"geo_lat" numeric(9, 6),
	"geo_lon" numeric(9, 6),
	"timezone" text,
	"official_site" text,
	"circuit" "circuit" DEFAULT 'OTRO' NOT NULL,
	"scope" "competition_scope" NOT NULL,
	"regional_federation" text,
	"content_hash" text NOT NULL,
	"source_modified_at" timestamp with time zone,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone,
	"cancelled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "event_source_key" UNIQUE("source","source_id")
);
--> statement-breakpoint
CREATE TABLE "event_competition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"weapon" "weapon" NOT NULL,
	"gender" "gender" NOT NULL,
	"category" "category_code" NOT NULL,
	"category_raw" text,
	"format" "competition_format" DEFAULT 'INDIVIDUAL' NOT NULL,
	"competition_date" date,
	"installation_open" text,
	"call_time" text,
	"scratch_time" text,
	"start_time" text,
	"registration_count" integer,
	"fee_eur" numeric(8, 2),
	"source_id" text,
	"source_url" text,
	"content_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_competition_key" UNIQUE("event_id","weapon","gender","category","format")
);
--> statement-breakpoint
CREATE TABLE "event_deadline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_competition_id" uuid,
	"type" "deadline_type" NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"surcharge_eur" numeric(8, 2),
	"is_blocking" boolean DEFAULT false NOT NULL,
	"origin" "deadline_origin" NOT NULL,
	"source_document" text,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_deadline_key" UNIQUE("event_id","event_competition_id","type")
);
--> statement-breakpoint
CREATE TABLE "event_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"kind" text,
	"published_at" date,
	"file_hash" text,
	CONSTRAINT "event_document_key" UNIQUE("event_id","url")
);
--> statement-breakpoint
CREATE TABLE "ingest_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingest_run_id" uuid NOT NULL,
	"source" "event_source" NOT NULL,
	"source_id" text,
	"raw_payload" jsonb NOT NULL,
	"validation_errors" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "event_source" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"status" "ingest_status" DEFAULT 'ok' NOT NULL,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_created" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"items_quarantined" integer DEFAULT 0 NOT NULL,
	"notifications_queued" integer DEFAULT 0 NOT NULL,
	"error" text,
	"snapshot_url" text,
	"snapshot_hash" text,
	"triggered_by" text DEFAULT 'cron' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wp_media_id" integer NOT NULL,
	"title" text NOT NULL,
	"pdf_url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"circular_number" text,
	"season_label" text,
	"event_id" uuid,
	"mentions_fees" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_profile_id" uuid,
	"file_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_document_wp_media_id_unique" UNIQUE("wp_media_id")
);
--> statement-breakpoint
CREATE TABLE "config_change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by_profile_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"scope" "competition_scope" NOT NULL,
	"circuit" "circuit",
	"category" "category_code",
	"type" "deadline_type" NOT NULL,
	"label" text NOT NULL,
	"days_before" integer NOT NULL,
	"surcharge_eur" numeric(8, 2),
	"is_blocking" boolean DEFAULT false NOT NULL,
	"source_document" text,
	"source_url" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_profile_id" uuid,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"weapon" "weapon",
	"category" "category_code",
	"counting_events" smallint NOT NULL,
	"coefficients" jsonb NOT NULL,
	"points_table" jsonb NOT NULL,
	"ranking_places" smallint DEFAULT 0 NOT NULL,
	"technical_places" smallint DEFAULT 0 NOT NULL,
	"cutoff_date" timestamp with time zone,
	"source_document" text,
	"source_url" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_profile_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ranking_rule_key" UNIQUE("season_id","weapon","category")
);
--> statement-breakpoint
CREATE TABLE "call_up" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"pdf_url" text,
	"pdf_name" text,
	"travel_notes" text,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"respond_by" timestamp with time zone,
	"created_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_up_athlete" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_up_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"event_competition_id" uuid,
	"place_type" "place_type" DEFAULT 'ranking' NOT NULL,
	"ranking_position_at_cutoff" integer,
	"status" "call_up_athlete_status" DEFAULT 'pendiente' NOT NULL,
	"responded_at" timestamp with time zone,
	"rejection_reason" text,
	"respond_by" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_up_athlete_key" UNIQUE("call_up_id","athlete_id","event_competition_id")
);
--> statement-breakpoint
CREATE TABLE "club_skermo_settings" (
	"club_id" uuid PRIMARY KEY NOT NULL,
	"direct_submit_enabled" boolean DEFAULT false NOT NULL,
	"skermo_username" text,
	"encrypted_password" text,
	"credential_stored_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"event_competition_id" uuid NOT NULL,
	"status" "entry_status" DEFAULT 'draft' NOT NULL,
	"requested_by_profile_id" uuid,
	"requested_at" timestamp with time zone,
	"club_decided_by_profile_id" uuid,
	"club_decided_at" timestamp with time zone,
	"federation_decided_by_profile_id" uuid,
	"federation_decided_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reason" text,
	"applied_deadline_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_athlete_competition_key" UNIQUE("athlete_id","event_competition_id")
);
--> statement-breakpoint
CREATE TABLE "entry_event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"from_status" "entry_status",
	"to_status" "entry_status" NOT NULL,
	"actor_profile_id" uuid,
	"actor_label" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_email" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"related_entry_id" uuid,
	"related_event_id" uuid,
	"related_call_up_id" uuid,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"status" "submission_status" DEFAULT 'dry_run' NOT NULL,
	"request_snapshot" jsonb,
	"response_status" integer,
	"response_snapshot" text,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"triggered_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "live_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_competition_id" uuid,
	"platform" text NOT NULL,
	"kind" text DEFAULT 'resultados' NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"added_by_profile_id" uuid,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_source_key" UNIQUE("event_id","event_competition_id","url")
);
--> statement-breakpoint
CREATE TABLE "extraction_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_hash" text NOT NULL,
	"document_url" text NOT NULL,
	"event_id" uuid,
	"field" text NOT NULL,
	"proposed_value" text NOT NULL,
	"quote" text NOT NULL,
	"quote_verified" numeric(1, 0) DEFAULT '0' NOT NULL,
	"model" text,
	"status" "proposal_status" DEFAULT 'pendiente' NOT NULL,
	"reviewed_by_profile_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_proposal_key" UNIQUE("document_hash","field")
);
--> statement-breakpoint
CREATE TABLE "ranking_point" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"event_competition_id" uuid NOT NULL,
	"result_id" uuid,
	"position" integer NOT NULL,
	"base_points" numeric(10, 2) NOT NULL,
	"coefficient" numeric(5, 3) NOT NULL,
	"final_points" numeric(10, 2) NOT NULL,
	"counted" numeric(1, 0) DEFAULT '0' NOT NULL,
	"explanation" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranking_point_key" UNIQUE("athlete_id","event_competition_id")
);
--> statement-breakpoint
CREATE TABLE "ranking_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"weapon" "weapon" NOT NULL,
	"gender" "gender" NOT NULL,
	"category" "category_code" NOT NULL,
	"athlete_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"total_points" numeric(10, 2) NOT NULL,
	"counted_event_ids" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_competition_id" uuid,
	"event_id" uuid,
	"athlete_id" uuid,
	"source_athlete_name" text NOT NULL,
	"source_license" text,
	"source_club" text,
	"position" integer NOT NULL,
	"official_points" numeric(10, 2),
	"weapon" "weapon",
	"gender" "gender",
	"category" "category_code",
	"source_url" text,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_key" UNIQUE("event_competition_id","source_athlete_name","position")
);
--> statement-breakpoint
ALTER TABLE "athlete" ADD CONSTRAINT "athlete_user_profile_id_user_profile_id_fk" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete" ADD CONSTRAINT "athlete_guardian_profile_id_user_profile_id_fk" FOREIGN KEY ("guardian_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete" ADD CONSTRAINT "athlete_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_weapon" ADD CONSTRAINT "athlete_weapon_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_category" ADD CONSTRAINT "season_category_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_category" ADD CONSTRAINT "season_category_updated_by_profile_id_user_profile_id_fk" FOREIGN KEY ("updated_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_competition" ADD CONSTRAINT "event_competition_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_deadline" ADD CONSTRAINT "event_deadline_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_deadline" ADD CONSTRAINT "event_deadline_event_competition_id_event_competition_id_fk" FOREIGN KEY ("event_competition_id") REFERENCES "public"."event_competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_document" ADD CONSTRAINT "event_document_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_quarantine" ADD CONSTRAINT "ingest_quarantine_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_document" ADD CONSTRAINT "official_document_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_document" ADD CONSTRAINT "official_document_reviewed_by_profile_id_user_profile_id_fk" FOREIGN KEY ("reviewed_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_change_log" ADD CONSTRAINT "config_change_log_changed_by_profile_id_user_profile_id_fk" FOREIGN KEY ("changed_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_rule" ADD CONSTRAINT "deadline_rule_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_rule" ADD CONSTRAINT "deadline_rule_updated_by_profile_id_user_profile_id_fk" FOREIGN KEY ("updated_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_rule" ADD CONSTRAINT "ranking_rule_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_rule" ADD CONSTRAINT "ranking_rule_updated_by_profile_id_user_profile_id_fk" FOREIGN KEY ("updated_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_up" ADD CONSTRAINT "call_up_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_up" ADD CONSTRAINT "call_up_created_by_profile_id_user_profile_id_fk" FOREIGN KEY ("created_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_up_athlete" ADD CONSTRAINT "call_up_athlete_call_up_id_call_up_id_fk" FOREIGN KEY ("call_up_id") REFERENCES "public"."call_up"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_up_athlete" ADD CONSTRAINT "call_up_athlete_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_up_athlete" ADD CONSTRAINT "call_up_athlete_event_competition_id_event_competition_id_fk" FOREIGN KEY ("event_competition_id") REFERENCES "public"."event_competition"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_skermo_settings" ADD CONSTRAINT "club_skermo_settings_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_event_competition_id_event_competition_id_fk" FOREIGN KEY ("event_competition_id") REFERENCES "public"."event_competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_requested_by_profile_id_user_profile_id_fk" FOREIGN KEY ("requested_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_club_decided_by_profile_id_user_profile_id_fk" FOREIGN KEY ("club_decided_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_federation_decided_by_profile_id_user_profile_id_fk" FOREIGN KEY ("federation_decided_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_event_log" ADD CONSTRAINT "entry_event_log_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_event_log" ADD CONSTRAINT "entry_event_log_actor_profile_id_user_profile_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_related_entry_id_entry_id_fk" FOREIGN KEY ("related_entry_id") REFERENCES "public"."entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_related_event_id_event_id_fk" FOREIGN KEY ("related_event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_related_call_up_id_call_up_id_fk" FOREIGN KEY ("related_call_up_id") REFERENCES "public"."call_up"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_triggered_by_profile_id_user_profile_id_fk" FOREIGN KEY ("triggered_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_source" ADD CONSTRAINT "live_source_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_source" ADD CONSTRAINT "live_source_event_competition_id_event_competition_id_fk" FOREIGN KEY ("event_competition_id") REFERENCES "public"."event_competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_source" ADD CONSTRAINT "live_source_added_by_profile_id_user_profile_id_fk" FOREIGN KEY ("added_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_proposal" ADD CONSTRAINT "extraction_proposal_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_proposal" ADD CONSTRAINT "extraction_proposal_reviewed_by_profile_id_user_profile_id_fk" FOREIGN KEY ("reviewed_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_point" ADD CONSTRAINT "ranking_point_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_point" ADD CONSTRAINT "ranking_point_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_point" ADD CONSTRAINT "ranking_point_event_competition_id_event_competition_id_fk" FOREIGN KEY ("event_competition_id") REFERENCES "public"."event_competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_point" ADD CONSTRAINT "ranking_point_result_id_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."result"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_snapshot" ADD CONSTRAINT "ranking_snapshot_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_snapshot" ADD CONSTRAINT "ranking_snapshot_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_event_competition_id_event_competition_id_fk" FOREIGN KEY ("event_competition_id") REFERENCES "public"."event_competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athlete"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athlete_club_idx" ON "athlete" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "athlete_guardian_idx" ON "athlete" USING btree ("guardian_profile_id");--> statement-breakpoint
CREATE INDEX "user_profile_club_idx" ON "user_profile" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "event_start_idx" ON "event" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "event_scope_idx" ON "event" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "event_competition_filter_idx" ON "event_competition" USING btree ("weapon","gender","category");--> statement-breakpoint
CREATE INDEX "event_deadline_at_idx" ON "event_deadline" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX "ingest_quarantine_open_idx" ON "ingest_quarantine" USING btree ("source","resolved_at");--> statement-breakpoint
CREATE INDEX "ingest_run_source_idx" ON "ingest_run" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "official_document_published_idx" ON "official_document" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "config_change_log_row_idx" ON "config_change_log" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "deadline_rule_lookup_idx" ON "deadline_rule" USING btree ("season_id","scope","circuit","active");--> statement-breakpoint
CREATE INDEX "call_up_event_idx" ON "call_up" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "call_up_athlete_athlete_idx" ON "call_up_athlete" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "entry_status_idx" ON "entry" USING btree ("status");--> statement-breakpoint
CREATE INDEX "entry_athlete_idx" ON "entry" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "entry_event_log_entry_idx" ON "entry_event_log" USING btree ("entry_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_pending_idx" ON "notification" USING btree ("sent_at","created_at");--> statement-breakpoint
CREATE INDEX "submission_status_idx" ON "submission" USING btree ("status");--> statement-breakpoint
CREATE INDEX "live_source_event_idx" ON "live_source" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "extraction_proposal_status_idx" ON "extraction_proposal" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ranking_point_season_idx" ON "ranking_point" USING btree ("season_id","athlete_id");--> statement-breakpoint
CREATE INDEX "ranking_snapshot_lookup_idx" ON "ranking_snapshot" USING btree ("season_id","weapon","gender","category","computed_at");--> statement-breakpoint
CREATE INDEX "result_athlete_idx" ON "result" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "result_unmatched_idx" ON "result" USING btree ("athlete_id","ingested_at");