-- SQLite/D1-native application schema. No source data or production cutover.
-- PostgreSQL 0021 write-fence triggers are intentionally NOT included.
CREATE TABLE `athlete` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`user_profile_id` text,
	`guardian_profile_id` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`birth_date` text NOT NULL,
	`gender` text NOT NULL,
	`club_id` text,
	`rfee_license` text,
	`fie_license` text,
	`fie_license_valid_until` text,
	`rfee_license_valid_until` text,
	`consent_signed_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`linked_via` text,
	`linked_at` integer,
	`linked_by_profile_id` text,
	`linked_evidence` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`user_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`guardian_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`club_id`) REFERENCES `club`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "athlete_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "athlete_consent_signed_at_integer" CHECK("consent_signed_at" IS NULL OR (typeof("consent_signed_at") = 'integer' AND "consent_signed_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "athlete_active_boolean" CHECK("active" IS NULL OR (typeof("active") = 'integer' AND "active" IN (0, 1))),
	CONSTRAINT "athlete_linked_at_integer" CHECK("linked_at" IS NULL OR (typeof("linked_at") = 'integer' AND "linked_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "athlete_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "athlete_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `athlete_club_idx` ON `athlete` (`club_id`);
--> statement-breakpoint
CREATE INDEX `athlete_guardian_idx` ON `athlete` (`guardian_profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_rfee_license_key` ON `athlete` (`rfee_license`);
--> statement-breakpoint
CREATE TABLE `athlete_weapon` (
	`athlete_id` text NOT NULL,
	`weapon` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`athlete_id`, `weapon`),
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "athlete_weapon_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "athlete_weapon_is_primary_boolean" CHECK("is_primary" IS NULL OR (typeof("is_primary") = 'integer' AND "is_primary" IN (0, 1)))
);

--> statement-breakpoint
CREATE TABLE `call_up` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`pdf_url` text,
	`pdf_name` text,
	`travel_notes` text,
	`published` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`respond_by` integer,
	`created_by_profile_id` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "call_up_published_boolean" CHECK("published" IS NULL OR (typeof("published") = 'integer' AND "published" IN (0, 1))),
	CONSTRAINT "call_up_published_at_integer" CHECK("published_at" IS NULL OR (typeof("published_at") = 'integer' AND "published_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "call_up_respond_by_integer" CHECK("respond_by" IS NULL OR (typeof("respond_by") = 'integer' AND "respond_by" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "call_up_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "call_up_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `call_up_event_idx` ON `call_up` (`event_id`);
--> statement-breakpoint
CREATE TABLE `call_up_athlete` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`call_up_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`event_competition_id` text,
	`place_type` text DEFAULT 'ranking' NOT NULL,
	`ranking_position_at_cutoff` integer,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`responded_at` integer,
	`rejection_reason` text,
	`respond_by` integer,
	`notified_at` integer,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`call_up_id`) REFERENCES `call_up`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_competition_id`) REFERENCES `event_competition`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "call_up_athlete_place_type_enum" CHECK("place_type" IN ('ranking', 'tecnica')),
	CONSTRAINT "call_up_athlete_ranking_position_at_cutoff_integer" CHECK("ranking_position_at_cutoff" IS NULL OR (typeof("ranking_position_at_cutoff") = 'integer' AND "ranking_position_at_cutoff" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "call_up_athlete_status_enum" CHECK("status" IN ('pendiente', 'confirmado', 'rechazado')),
	CONSTRAINT "call_up_athlete_responded_at_integer" CHECK("responded_at" IS NULL OR (typeof("responded_at") = 'integer' AND "responded_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "call_up_athlete_respond_by_integer" CHECK("respond_by" IS NULL OR (typeof("respond_by") = 'integer' AND "respond_by" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "call_up_athlete_notified_at_integer" CHECK("notified_at" IS NULL OR (typeof("notified_at") = 'integer' AND "notified_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "call_up_athlete_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `call_up_athlete_athlete_idx` ON `call_up_athlete` (`athlete_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `call_up_athlete_key` ON `call_up_athlete` (`call_up_id`,`athlete_id`,`event_competition_id`);
--> statement-breakpoint
CREATE TABLE `club` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`regional_federation` text,
	`contact_email` text,
	`skermo_club_code` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	CONSTRAINT "club_active_boolean" CHECK("active" IS NULL OR (typeof("active") = 'integer' AND "active" IN (0, 1))),
	CONSTRAINT "club_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE TABLE `club_skermo_settings` (
	`club_id` text PRIMARY KEY NOT NULL,
	`direct_submit_enabled` integer DEFAULT false NOT NULL,
	`skermo_username` text,
	`encrypted_password` text,
	`credential_stored_at` integer,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `club`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "club_skermo_settings_direct_submit_enabled_boolean" CHECK("direct_submit_enabled" IS NULL OR (typeof("direct_submit_enabled") = 'integer' AND "direct_submit_enabled" IN (0, 1))),
	CONSTRAINT "club_skermo_settings_credential_stored_at_integer" CHECK("credential_stored_at" IS NULL OR (typeof("credential_stored_at") = 'integer' AND "credential_stored_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "club_skermo_settings_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE TABLE `competition_registration` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`event_competition_id` text NOT NULL,
	`athlete_id` text,
	`source_athlete_name` text NOT NULL,
	`source_team` text DEFAULT '' NOT NULL,
	`source_license` text,
	`source_club` text,
	`source_registered_at` text,
	`source` text NOT NULL,
	`source_url` text,
	`first_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`withdrawn_at` integer,
	FOREIGN KEY (`event_competition_id`) REFERENCES `event_competition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "competition_registration_source_enum" CHECK("source" IN ('skermo_rfee', 'skermo_regional', 'fie', 'efc', 'rfee_wp', 'skermo_ranking', 'fie_tiradores')),
	CONSTRAINT "competition_registration_first_seen_at_integer" CHECK("first_seen_at" IS NULL OR (typeof("first_seen_at") = 'integer' AND "first_seen_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "competition_registration_last_seen_at_integer" CHECK("last_seen_at" IS NULL OR (typeof("last_seen_at") = 'integer' AND "last_seen_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "competition_registration_withdrawn_at_integer" CHECK("withdrawn_at" IS NULL OR (typeof("withdrawn_at") = 'integer' AND "withdrawn_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `competition_registration_competition_idx` ON `competition_registration` (`event_competition_id`);
--> statement-breakpoint
CREATE INDEX `competition_registration_athlete_idx` ON `competition_registration` (`athlete_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `competition_registration_key` ON `competition_registration` (`event_competition_id`,`source_athlete_name`,`source_team`);
--> statement-breakpoint
CREATE TABLE `config_change_log` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`changed_by_profile_id` text,
	`changed_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`changed_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "config_change_log_before_json" CHECK("before" IS NULL OR (typeof("before") = 'text' AND json_valid("before"))),
	CONSTRAINT "config_change_log_after_json" CHECK("after" IS NULL OR (typeof("after") = 'text' AND json_valid("after"))),
	CONSTRAINT "config_change_log_changed_at_integer" CHECK("changed_at" IS NULL OR (typeof("changed_at") = 'integer' AND "changed_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `config_change_log_row_idx` ON `config_change_log` (`table_name`,`row_id`);
--> statement-breakpoint
CREATE TABLE `cron_execution` (
	`task` text NOT NULL,
	`scheduled_minute` integer NOT NULL,
	`status` text DEFAULT 'reclamada' NOT NULL,
	`claimed_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`finished_at` integer,
	`http_status` integer,
	`failure_code` text,
	PRIMARY KEY(`task`, `scheduled_minute`),
	CONSTRAINT "cron_execution_minute_check" CHECK("cron_execution"."scheduled_minute" >= 0),
	CONSTRAINT "cron_execution_status_check" CHECK("cron_execution"."status" IN ('reclamada', 'completada', 'fallida')),
	CONSTRAINT "cron_execution_http_check" CHECK("cron_execution"."http_status" IS NULL OR "cron_execution"."http_status" BETWEEN 100 AND 599),
	CONSTRAINT "cron_execution_failure_check" CHECK("cron_execution"."failure_code" IS NULL OR "cron_execution"."failure_code" IN ('http', 'resultado', 'respuesta_invalida', 'excepcion')),
	CONSTRAINT "cron_execution_scheduled_minute_integer" CHECK("scheduled_minute" IS NULL OR (typeof("scheduled_minute") = 'integer' AND "scheduled_minute" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "cron_execution_status_enum" CHECK("status" IN ('reclamada', 'completada', 'fallida')),
	CONSTRAINT "cron_execution_claimed_at_integer" CHECK("claimed_at" IS NULL OR (typeof("claimed_at") = 'integer' AND "claimed_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "cron_execution_finished_at_integer" CHECK("finished_at" IS NULL OR (typeof("finished_at") = 'integer' AND "finished_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "cron_execution_http_status_integer" CHECK("http_status" IS NULL OR (typeof("http_status") = 'integer' AND "http_status" BETWEEN -2147483648 AND 2147483647))
);

--> statement-breakpoint
CREATE TABLE `deadline_rule` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`season_id` text NOT NULL,
	`scope` text NOT NULL,
	`circuit` text,
	`category` text,
	`format` text,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`days_before` integer NOT NULL,
	`weekday` integer,
	`weeks_before` integer DEFAULT 0 NOT NULL,
	`time_of_day` text,
	`surcharge_eur` text,
	`is_blocking` integer DEFAULT false NOT NULL,
	`source_document` text,
	`source_url` text,
	`effective_from` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_by_profile_id` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deadline_rule_scope_enum" CHECK("scope" IN ('NACIONAL', 'INTERNACIONAL', 'AUTONOMICO')),
	CONSTRAINT "deadline_rule_circuit_enum" CHECK("circuit" IN ('TNR', 'LIGA_ORO', 'LIGA_PLATA', 'LIGA_IBERDROLA', 'LIGA_BRONCE', 'LIGA_CLUBES', 'CTO_ESPANA', 'CONCENTRACION', 'SATELITE', 'FIE_CIRCUITO', 'ECC', 'EUR_CLUBES', 'U14_EFC', 'SUB23_EFC', 'EFC_LEAGUE', 'EUV', 'CAD_WC', 'JUN_WC', 'SEN_WC', 'SEN_GP', 'CTO_EUROPA', 'CTO_MUNDO', 'TLM', 'OTRO')),
	CONSTRAINT "deadline_rule_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "deadline_rule_format_enum" CHECK("format" IN ('INDIVIDUAL', 'EQUIPOS')),
	CONSTRAINT "deadline_rule_type_enum" CHECK("type" IN ('L1', 'L2', 'L3', 'FIE_D7')),
	CONSTRAINT "deadline_rule_days_before_integer" CHECK("days_before" IS NULL OR (typeof("days_before") = 'integer' AND "days_before" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "deadline_rule_weekday_integer" CHECK("weekday" IS NULL OR (typeof("weekday") = 'integer' AND "weekday" BETWEEN -32768 AND 32767)),
	CONSTRAINT "deadline_rule_weeks_before_integer" CHECK("weeks_before" IS NULL OR (typeof("weeks_before") = 'integer' AND "weeks_before" BETWEEN -32768 AND 32767)),
	CONSTRAINT "deadline_rule_is_blocking_boolean" CHECK("is_blocking" IS NULL OR (typeof("is_blocking") = 'integer' AND "is_blocking" IN (0, 1))),
	CONSTRAINT "deadline_rule_effective_from_integer" CHECK("effective_from" IS NULL OR (typeof("effective_from") = 'integer' AND "effective_from" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "deadline_rule_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "deadline_rule_active_boolean" CHECK("active" IS NULL OR (typeof("active") = 'integer' AND "active" IN (0, 1))),
	CONSTRAINT "deadline_rule_weekday_iso" CHECK("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7),
	CONSTRAINT "deadline_rule_time_of_day_hhmm" CHECK("time_of_day" IS NULL OR (length("time_of_day") = 5 AND "time_of_day" GLOB '[0-2][0-9]:[0-5][0-9]' AND substr("time_of_day", 1, 2) <= '23'))
);

--> statement-breakpoint
CREATE INDEX `deadline_rule_lookup_idx` ON `deadline_rule` (`season_id`,`scope`,`circuit`,`active`);
--> statement-breakpoint
CREATE TABLE `documento_vigencia` (
	`documento_id` text PRIMARY KEY NOT NULL,
	`familia` text NOT NULL,
	`asunto` text NOT NULL,
	`temporada` text,
	`temporada_inferida` integer DEFAULT false NOT NULL,
	`numero_circular` text,
	`etiqueta_version` text,
	`orden_version` integer DEFAULT 100 NOT NULL,
	`versiones_en_familia` integer DEFAULT 1 NOT NULL,
	`estado` text NOT NULL,
	`sustituida_por_id` text,
	`duplicado_de_id` text,
	`motivo` text,
	`hash_intentado_en` integer,
	`hash_error` text,
	`calculado_en` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`documento_id`) REFERENCES `official_document`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sustituida_por_id`) REFERENCES `official_document`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`duplicado_de_id`) REFERENCES `official_document`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "documento_vigencia_temporada_inferida_boolean" CHECK("temporada_inferida" IS NULL OR (typeof("temporada_inferida") = 'integer' AND "temporada_inferida" IN (0, 1))),
	CONSTRAINT "documento_vigencia_orden_version_integer" CHECK("orden_version" IS NULL OR (typeof("orden_version") = 'integer' AND "orden_version" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "documento_vigencia_versiones_en_familia_integer" CHECK("versiones_en_familia" IS NULL OR (typeof("versiones_en_familia") = 'integer' AND "versiones_en_familia" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "documento_vigencia_estado_enum" CHECK("estado" IN ('vigente', 'superada', 'cancelada', 'duplicada')),
	CONSTRAINT "documento_vigencia_hash_intentado_en_integer" CHECK("hash_intentado_en" IS NULL OR (typeof("hash_intentado_en") = 'integer' AND "hash_intentado_en" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "documento_vigencia_calculado_en_integer" CHECK("calculado_en" IS NULL OR (typeof("calculado_en") = 'integer' AND "calculado_en" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `documento_vigencia_estado_idx` ON `documento_vigencia` (`estado`);
--> statement-breakpoint
CREATE INDEX `documento_vigencia_familia_idx` ON `documento_vigencia` (`familia`);
--> statement-breakpoint
CREATE INDEX `documento_vigencia_intento_idx` ON `documento_vigencia` (`hash_intentado_en`);
--> statement-breakpoint
CREATE TABLE `entry` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`athlete_id` text NOT NULL,
	`event_competition_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`requested_by_profile_id` text,
	`requested_at` integer,
	`club_decided_by_profile_id` text,
	`club_decided_at` integer,
	`federation_decided_by_profile_id` text,
	`federation_decided_at` integer,
	`submitted_at` integer,
	`reason` text,
	`applied_deadline_id` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_competition_id`) REFERENCES `event_competition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`club_decided_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`federation_decided_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "entry_status_enum" CHECK("status" IN ('draft', 'pending_club', 'club_approved', 'federation_approved', 'submitted', 'rejected', 'withdrawn')),
	CONSTRAINT "entry_requested_at_integer" CHECK("requested_at" IS NULL OR (typeof("requested_at") = 'integer' AND "requested_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "entry_club_decided_at_integer" CHECK("club_decided_at" IS NULL OR (typeof("club_decided_at") = 'integer' AND "club_decided_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "entry_federation_decided_at_integer" CHECK("federation_decided_at" IS NULL OR (typeof("federation_decided_at") = 'integer' AND "federation_decided_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "entry_submitted_at_integer" CHECK("submitted_at" IS NULL OR (typeof("submitted_at") = 'integer' AND "submitted_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "entry_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "entry_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `entry_status_idx` ON `entry` (`status`);
--> statement-breakpoint
CREATE INDEX `entry_athlete_idx` ON `entry` (`athlete_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_athlete_competition_key` ON `entry` (`athlete_id`,`event_competition_id`);
--> statement-breakpoint
CREATE TABLE `entry_event_log` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`entry_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_profile_id` text,
	`actor_label` text,
	`reason` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "entry_event_log_from_status_enum" CHECK("from_status" IN ('draft', 'pending_club', 'club_approved', 'federation_approved', 'submitted', 'rejected', 'withdrawn')),
	CONSTRAINT "entry_event_log_to_status_enum" CHECK("to_status" IN ('draft', 'pending_club', 'club_approved', 'federation_approved', 'submitted', 'rejected', 'withdrawn')),
	CONSTRAINT "entry_event_log_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `entry_event_log_entry_idx` ON `entry_event_log` (`entry_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`source_url` text,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`venue` text,
	`city` text,
	`country` text,
	`venue_address` text,
	`geo_lat` text,
	`geo_lon` text,
	`timezone` text,
	`official_site` text,
	`image_url` text,
	`circuit` text DEFAULT 'OTRO' NOT NULL,
	`scope` text NOT NULL,
	`regional_federation` text,
	`content_hash` text NOT NULL,
	`source_modified_at` integer,
	`notes` text,
	`first_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`disappeared_at` integer,
	`cancelled` integer DEFAULT false NOT NULL,
	`canonical_event_id` text,
	FOREIGN KEY (`canonical_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "event_source_enum" CHECK("source" IN ('skermo_rfee', 'skermo_regional', 'fie', 'efc', 'rfee_wp', 'skermo_ranking', 'fie_tiradores')),
	CONSTRAINT "event_circuit_enum" CHECK("circuit" IN ('TNR', 'LIGA_ORO', 'LIGA_PLATA', 'LIGA_IBERDROLA', 'LIGA_BRONCE', 'LIGA_CLUBES', 'CTO_ESPANA', 'CONCENTRACION', 'SATELITE', 'FIE_CIRCUITO', 'ECC', 'EUR_CLUBES', 'U14_EFC', 'SUB23_EFC', 'EFC_LEAGUE', 'EUV', 'CAD_WC', 'JUN_WC', 'SEN_WC', 'SEN_GP', 'CTO_EUROPA', 'CTO_MUNDO', 'TLM', 'OTRO')),
	CONSTRAINT "event_scope_enum" CHECK("scope" IN ('NACIONAL', 'INTERNACIONAL', 'AUTONOMICO')),
	CONSTRAINT "event_source_modified_at_integer" CHECK("source_modified_at" IS NULL OR (typeof("source_modified_at") = 'integer' AND "source_modified_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "event_first_seen_at_integer" CHECK("first_seen_at" IS NULL OR (typeof("first_seen_at") = 'integer' AND "first_seen_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "event_last_seen_at_integer" CHECK("last_seen_at" IS NULL OR (typeof("last_seen_at") = 'integer' AND "last_seen_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "event_disappeared_at_integer" CHECK("disappeared_at" IS NULL OR (typeof("disappeared_at") = 'integer' AND "disappeared_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "event_cancelled_boolean" CHECK("cancelled" IS NULL OR (typeof("cancelled") = 'integer' AND "cancelled" IN (0, 1)))
);

--> statement-breakpoint
CREATE INDEX `event_start_idx` ON `event` (`start_date`);
--> statement-breakpoint
CREATE INDEX `event_scope_idx` ON `event` (`scope`);
--> statement-breakpoint
CREATE INDEX `event_canonical_idx` ON `event` (`canonical_event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_source_key` ON `event` (`source`,`source_id`);
--> statement-breakpoint
CREATE TABLE `event_competition` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`event_id` text NOT NULL,
	`weapon` text NOT NULL,
	`gender` text NOT NULL,
	`category` text NOT NULL,
	`category_raw` text,
	`format` text DEFAULT 'INDIVIDUAL' NOT NULL,
	`competition_date` text,
	`installation_open` text,
	`call_time` text,
	`scratch_time` text,
	`start_time` text,
	`registration_count` integer,
	`fee_eur` text,
	`source_id` text,
	`source_url` text,
	`content_hash` text NOT NULL,
	`last_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`registrations_hash` text,
	`registrations_checked_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_competition_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "event_competition_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "event_competition_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "event_competition_format_enum" CHECK("format" IN ('INDIVIDUAL', 'EQUIPOS')),
	CONSTRAINT "event_competition_registration_count_integer" CHECK("registration_count" IS NULL OR (typeof("registration_count") = 'integer' AND "registration_count" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "event_competition_last_seen_at_integer" CHECK("last_seen_at" IS NULL OR (typeof("last_seen_at") = 'integer' AND "last_seen_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "event_competition_registrations_checked_at_integer" CHECK("registrations_checked_at" IS NULL OR (typeof("registrations_checked_at") = 'integer' AND "registrations_checked_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `event_competition_filter_idx` ON `event_competition` (`weapon`,`gender`,`category`);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_competition_key` ON `event_competition` (`event_id`,`weapon`,`gender`,`category`,`format`);
--> statement-breakpoint
CREATE TABLE `event_deadline` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`event_id` text NOT NULL,
	`event_competition_id` text,
	`type` text NOT NULL,
	`deadline_at` integer NOT NULL,
	`surcharge_eur` text,
	`is_blocking` integer DEFAULT false NOT NULL,
	`origin` text NOT NULL,
	`source_document` text,
	`source_url` text,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_competition_id`) REFERENCES `event_competition`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_deadline_type_enum" CHECK("type" IN ('L1', 'L2', 'L3', 'FIE_D7')),
	CONSTRAINT "event_deadline_deadline_at_integer" CHECK("deadline_at" IS NULL OR (typeof("deadline_at") = 'integer' AND "deadline_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "event_deadline_is_blocking_boolean" CHECK("is_blocking" IS NULL OR (typeof("is_blocking") = 'integer' AND "is_blocking" IN (0, 1))),
	CONSTRAINT "event_deadline_origin_enum" CHECK("origin" IN ('PUBLICADO', 'CALCULADO')),
	CONSTRAINT "event_deadline_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `event_deadline_at_idx` ON `event_deadline` (`deadline_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_deadline_key` ON `event_deadline` (`event_id`,`event_competition_id`,`type`);
--> statement-breakpoint
CREATE TABLE `event_document` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`kind` text,
	`published_at` text,
	`file_hash` text,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE UNIQUE INDEX `event_document_key` ON `event_document` (`event_id`,`url`);
--> statement-breakpoint
CREATE TABLE `event_link` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`canonical_event_id` text NOT NULL,
	`linked_event_id` text NOT NULL,
	`status` text DEFAULT 'AUTOMATICO' NOT NULL,
	`city_key` text,
	`rule` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`decided_at` integer,
	`decided_by_profile_id` text,
	FOREIGN KEY (`canonical_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "event_link_status_enum" CHECK("status" IN ('AUTOMATICO', 'DUDOSO', 'CONFIRMADO', 'RECHAZADO')),
	CONSTRAINT "event_link_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "event_link_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "event_link_decided_at_integer" CHECK("decided_at" IS NULL OR (typeof("decided_at") = 'integer' AND "decided_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `event_link_linked_idx` ON `event_link` (`linked_event_id`);
--> statement-breakpoint
CREATE INDEX `event_link_status_idx` ON `event_link` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_link_key` ON `event_link` (`canonical_event_id`,`linked_event_id`);
--> statement-breakpoint
CREATE TABLE `extraccion_documento` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`documento_id` text,
	`evento_documento_id` text,
	`documento_url` text NOT NULL,
	`documento_titulo` text,
	`evento_id` text,
	`evento_certeza` text,
	`evento_motivo` text,
	`evento_confirmado_en` integer,
	`evento_confirmado_por_perfil_id` text,
	`hash_documento` text NOT NULL,
	`hash_prompt` text NOT NULL,
	`version_esquema` integer NOT NULL,
	`estado` text NOT NULL,
	`motivo` text,
	`modelo` text,
	`origen_texto` text,
	`paginas` integer,
	`caracteres_texto` integer,
	`propuesta_json` text,
	`descartadas_json` text,
	`campos_propuestos` integer DEFAULT 0 NOT NULL,
	`campos_descartados` integer DEFAULT 0 NOT NULL,
	`creado_en` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`documento_id`) REFERENCES `official_document`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`evento_documento_id`) REFERENCES `event_document`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`evento_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`evento_confirmado_por_perfil_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "extraccion_documento_evento_certeza_enum" CHECK("evento_certeza" IN ('seguro', 'dudoso', 'desconocido')),
	CONSTRAINT "extraccion_documento_evento_confirmado_en_integer" CHECK("evento_confirmado_en" IS NULL OR (typeof("evento_confirmado_en") = 'integer' AND "evento_confirmado_en" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "extraccion_documento_version_esquema_integer" CHECK("version_esquema" IS NULL OR (typeof("version_esquema") = 'integer' AND "version_esquema" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "extraccion_documento_estado_enum" CHECK("estado" IN ('ok', 'sin_texto', 'bloqueado_datos_personales', 'sin_modelo', 'error')),
	CONSTRAINT "extraccion_documento_origen_texto_enum" CHECK("origen_texto" IN ('unpdf', 'ocr_modelo', 'ooxml')),
	CONSTRAINT "extraccion_documento_paginas_integer" CHECK("paginas" IS NULL OR (typeof("paginas") = 'integer' AND "paginas" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "extraccion_documento_caracteres_texto_integer" CHECK("caracteres_texto" IS NULL OR (typeof("caracteres_texto") = 'integer' AND "caracteres_texto" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "extraccion_documento_propuesta_json_json" CHECK("propuesta_json" IS NULL OR (typeof("propuesta_json") = 'text' AND json_valid("propuesta_json"))),
	CONSTRAINT "extraccion_documento_descartadas_json_json" CHECK("descartadas_json" IS NULL OR (typeof("descartadas_json") = 'text' AND json_valid("descartadas_json"))),
	CONSTRAINT "extraccion_documento_campos_propuestos_integer" CHECK("campos_propuestos" IS NULL OR (typeof("campos_propuestos") = 'integer' AND "campos_propuestos" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "extraccion_documento_campos_descartados_integer" CHECK("campos_descartados" IS NULL OR (typeof("campos_descartados") = 'integer' AND "campos_descartados" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "extraccion_documento_creado_en_integer" CHECK("creado_en" IS NULL OR (typeof("creado_en") = 'integer' AND "creado_en" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `extraccion_documento_doc_idx` ON `extraccion_documento` (`documento_id`);
--> statement-breakpoint
CREATE INDEX `extraccion_documento_estado_idx` ON `extraccion_documento` (`estado`);
--> statement-breakpoint
CREATE INDEX `extraccion_documento_evento_doc_idx` ON `extraccion_documento` (`evento_documento_id`);
--> statement-breakpoint
CREATE INDEX `extraccion_documento_evento_idx` ON `extraccion_documento` (`evento_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `extraccion_documento_clave` ON `extraccion_documento` (`hash_documento`,`hash_prompt`,`version_esquema`);
--> statement-breakpoint
CREATE TABLE `extraccion_propuesta` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`extraccion_id` text NOT NULL,
	`documento_id` text,
	`hash_documento` text NOT NULL,
	`evento_id` text,
	`campo` text NOT NULL,
	`valor_propuesto` text NOT NULL,
	`prueba` text,
	`fecha` text,
	`cita` text NOT NULL,
	`cita_verificada` integer DEFAULT false NOT NULL,
	`contexto` text,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`revisado_por_perfil_id` text,
	`revisado_en` integer,
	`creado_en` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`extraccion_id`) REFERENCES `extraccion_documento`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`documento_id`) REFERENCES `official_document`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`evento_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revisado_por_perfil_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "extraccion_propuesta_cita_verificada_boolean" CHECK("cita_verificada" IS NULL OR (typeof("cita_verificada") = 'integer' AND "cita_verificada" IN (0, 1))),
	CONSTRAINT "extraccion_propuesta_estado_enum" CHECK("estado" IN ('pendiente', 'aprobada', 'rechazada')),
	CONSTRAINT "extraccion_propuesta_revisado_en_integer" CHECK("revisado_en" IS NULL OR (typeof("revisado_en") = 'integer' AND "revisado_en" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "extraccion_propuesta_creado_en_integer" CHECK("creado_en" IS NULL OR (typeof("creado_en") = 'integer' AND "creado_en" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `extraccion_propuesta_estado_idx` ON `extraccion_propuesta` (`estado`);
--> statement-breakpoint
CREATE INDEX `extraccion_propuesta_doc_idx` ON `extraccion_propuesta` (`documento_id`);
--> statement-breakpoint
CREATE INDEX `extraccion_propuesta_evento_idx` ON `extraccion_propuesta` (`evento_id`,`estado`);
--> statement-breakpoint
CREATE UNIQUE INDEX `extraccion_propuesta_clave` ON `extraccion_propuesta` (`extraccion_id`,`campo`);
--> statement-breakpoint
CREATE TABLE `extraction_proposal` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`document_hash` text NOT NULL,
	`document_url` text NOT NULL,
	`event_id` text,
	`field` text NOT NULL,
	`proposed_value` text NOT NULL,
	`quote` text NOT NULL,
	`quote_verified` text DEFAULT '0' NOT NULL,
	`model` text,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`reviewed_by_profile_id` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "extraction_proposal_status_enum" CHECK("status" IN ('pendiente', 'aprobada', 'descartada')),
	CONSTRAINT "extraction_proposal_reviewed_at_integer" CHECK("reviewed_at" IS NULL OR (typeof("reviewed_at") = 'integer' AND "reviewed_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "extraction_proposal_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `extraction_proposal_status_idx` ON `extraction_proposal` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `extraction_proposal_key` ON `extraction_proposal` (`document_hash`,`field`);
--> statement-breakpoint
CREATE TABLE `fie_clasificacion` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`season` integer NOT NULL,
	`weapon` text NOT NULL,
	`gender` text NOT NULL,
	`category` text NOT NULL,
	`category_raw` text NOT NULL,
	`format` text NOT NULL,
	`fie_id` integer NOT NULL,
	`position` integer,
	`points` text,
	`source_name` text,
	`country_code` text,
	`country_name` text,
	`event_count` integer,
	`source_url` text,
	`content_hash` text NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	CONSTRAINT "fie_clasificacion_season_integer" CHECK("season" IS NULL OR (typeof("season") = 'integer' AND "season" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_clasificacion_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "fie_clasificacion_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "fie_clasificacion_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "fie_clasificacion_format_enum" CHECK("format" IN ('INDIVIDUAL', 'EQUIPOS')),
	CONSTRAINT "fie_clasificacion_fie_id_integer" CHECK("fie_id" IS NULL OR (typeof("fie_id") = 'integer' AND "fie_id" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_clasificacion_position_integer" CHECK("position" IS NULL OR (typeof("position") = 'integer' AND "position" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_clasificacion_event_count_integer" CHECK("event_count" IS NULL OR (typeof("event_count") = 'integer' AND "event_count" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_clasificacion_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `fie_clasificacion_grupo_idx` ON `fie_clasificacion` (`season`,`format`,`weapon`,`gender`,`category`,`position`);
--> statement-breakpoint
CREATE INDEX `fie_clasificacion_pais_idx` ON `fie_clasificacion` (`country_code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `fie_clasificacion_key` ON `fie_clasificacion` (`season`,`weapon`,`gender`,`category_raw`,`format`,`fie_id`);
--> statement-breakpoint
CREATE TABLE `fie_fencer` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`fie_id` integer NOT NULL,
	`athlete_id` text,
	`proposed_athlete_id` text,
	`link_status` text DEFAULT 'PROPUESTO' NOT NULL,
	`linked_via` text,
	`linked_at` integer,
	`match_evidence` text,
	`source_name` text NOT NULL,
	`source_first_name` text,
	`source_last_name` text,
	`country_code` text,
	`source_birth_date` text,
	`hand` text,
	`photo_url` text,
	`profile_url` text NOT NULL,
	`fie_license` text,
	`fie_license_status` text,
	`content_hash` text NOT NULL,
	`ingested_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`proposed_athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "fie_fencer_fie_id_integer" CHECK("fie_id" IS NULL OR (typeof("fie_id") = 'integer' AND "fie_id" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_fencer_link_status_enum" CHECK("link_status" IN ('PROPUESTO', 'CONFIRMADO', 'RECHAZADO')),
	CONSTRAINT "fie_fencer_linked_at_integer" CHECK("linked_at" IS NULL OR (typeof("linked_at") = 'integer' AND "linked_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "fie_fencer_ingested_at_integer" CHECK("ingested_at" IS NULL OR (typeof("ingested_at") = 'integer' AND "ingested_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "fie_fencer_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `fie_fencer_athlete_idx` ON `fie_fencer` (`athlete_id`);
--> statement-breakpoint
CREATE INDEX `fie_fencer_pendiente_idx` ON `fie_fencer` (`link_status`,`proposed_athlete_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `fie_fencer_key` ON `fie_fencer` (`fie_id`);
--> statement-breakpoint
CREATE TABLE `fie_world_ranking` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`fie_id` integer NOT NULL,
	`season` integer NOT NULL,
	`weapon` text NOT NULL,
	`gender` text NOT NULL,
	`category` text NOT NULL,
	`category_raw` text NOT NULL,
	`age_band` text,
	`position` integer,
	`points` text,
	`event_count` integer,
	`source_url` text,
	`content_hash` text NOT NULL,
	`ingested_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	CONSTRAINT "fie_world_ranking_fie_id_integer" CHECK("fie_id" IS NULL OR (typeof("fie_id") = 'integer' AND "fie_id" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_world_ranking_season_integer" CHECK("season" IS NULL OR (typeof("season") = 'integer' AND "season" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_world_ranking_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "fie_world_ranking_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "fie_world_ranking_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "fie_world_ranking_position_integer" CHECK("position" IS NULL OR (typeof("position") = 'integer' AND "position" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_world_ranking_event_count_integer" CHECK("event_count" IS NULL OR (typeof("event_count") = 'integer' AND "event_count" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "fie_world_ranking_ingested_at_integer" CHECK("ingested_at" IS NULL OR (typeof("ingested_at") = 'integer' AND "ingested_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "fie_world_ranking_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `fie_world_ranking_fencer_idx` ON `fie_world_ranking` (`fie_id`,`season`);
--> statement-breakpoint
CREATE UNIQUE INDEX `fie_world_ranking_key` ON `fie_world_ranking` (`fie_id`,`season`,`weapon`,`gender`,`category_raw`);
--> statement-breakpoint
CREATE TABLE `ingest_quarantine` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`ingest_run_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`raw_payload` text NOT NULL,
	`validation_errors` text NOT NULL,
	`resolved_at` integer,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`ingest_run_id`) REFERENCES `ingest_run`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ingest_quarantine_source_enum" CHECK("source" IN ('skermo_rfee', 'skermo_regional', 'fie', 'efc', 'rfee_wp', 'skermo_ranking', 'fie_tiradores')),
	CONSTRAINT "ingest_quarantine_raw_payload_json" CHECK("raw_payload" IS NULL OR (typeof("raw_payload") = 'text' AND json_valid("raw_payload"))),
	CONSTRAINT "ingest_quarantine_validation_errors_json" CHECK("validation_errors" IS NULL OR (typeof("validation_errors") = 'text' AND json_valid("validation_errors"))),
	CONSTRAINT "ingest_quarantine_resolved_at_integer" CHECK("resolved_at" IS NULL OR (typeof("resolved_at") = 'integer' AND "resolved_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "ingest_quarantine_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `ingest_quarantine_open_idx` ON `ingest_quarantine` (`source`,`resolved_at`);
--> statement-breakpoint
CREATE TABLE `ingest_run` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`source` text NOT NULL,
	`started_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`status` text DEFAULT 'ok' NOT NULL,
	`items_seen` integer DEFAULT 0 NOT NULL,
	`items_created` integer DEFAULT 0 NOT NULL,
	`items_updated` integer DEFAULT 0 NOT NULL,
	`items_quarantined` integer DEFAULT 0 NOT NULL,
	`notifications_queued` integer DEFAULT 0 NOT NULL,
	`error` text,
	`snapshot_url` text,
	`snapshot_hash` text,
	`triggered_by` text DEFAULT 'cron' NOT NULL,
	CONSTRAINT "ingest_run_source_enum" CHECK("source" IN ('skermo_rfee', 'skermo_regional', 'fie', 'efc', 'rfee_wp', 'skermo_ranking', 'fie_tiradores')),
	CONSTRAINT "ingest_run_started_at_integer" CHECK("started_at" IS NULL OR (typeof("started_at") = 'integer' AND "started_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "ingest_run_finished_at_integer" CHECK("finished_at" IS NULL OR (typeof("finished_at") = 'integer' AND "finished_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "ingest_run_duration_ms_integer" CHECK("duration_ms" IS NULL OR (typeof("duration_ms") = 'integer' AND "duration_ms" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "ingest_run_status_enum" CHECK("status" IN ('ok', 'parcial', 'error')),
	CONSTRAINT "ingest_run_items_seen_integer" CHECK("items_seen" IS NULL OR (typeof("items_seen") = 'integer' AND "items_seen" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "ingest_run_items_created_integer" CHECK("items_created" IS NULL OR (typeof("items_created") = 'integer' AND "items_created" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "ingest_run_items_updated_integer" CHECK("items_updated" IS NULL OR (typeof("items_updated") = 'integer' AND "items_updated" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "ingest_run_items_quarantined_integer" CHECK("items_quarantined" IS NULL OR (typeof("items_quarantined") = 'integer' AND "items_quarantined" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "ingest_run_notifications_queued_integer" CHECK("notifications_queued" IS NULL OR (typeof("notifications_queued") = 'integer' AND "notifications_queued" BETWEEN -2147483648 AND 2147483647))
);

--> statement-breakpoint
CREATE INDEX `ingest_run_source_idx` ON `ingest_run` (`source`,`started_at`);
--> statement-breakpoint
CREATE TABLE `live_source` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`event_id` text NOT NULL,
	`event_competition_id` text,
	`platform` text NOT NULL,
	`kind` text DEFAULT 'resultados' NOT NULL,
	`url` text NOT NULL,
	`label` text,
	`added_by_profile_id` text,
	`is_automatic` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_competition_id`) REFERENCES `event_competition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "live_source_is_automatic_boolean" CHECK("is_automatic" IS NULL OR (typeof("is_automatic") = 'integer' AND "is_automatic" IN (0, 1))),
	CONSTRAINT "live_source_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `live_source_event_idx` ON `live_source` (`event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_source_key` ON `live_source` (`event_id`,`event_competition_id`,`url`);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`dedupe_key` text NOT NULL,
	`to_email` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`related_entry_id` text,
	`related_event_id` text,
	`related_call_up_id` text,
	`sent_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`related_entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`related_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`related_call_up_id`) REFERENCES `call_up`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notification_sent_at_integer" CHECK("sent_at" IS NULL OR (typeof("sent_at") = 'integer' AND "sent_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "notification_attempts_integer" CHECK("attempts" IS NULL OR (typeof("attempts") = 'integer' AND "attempts" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "notification_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `notification_dedupe_key_unique` ON `notification` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `notification_pending_idx` ON `notification` (`sent_at`,`created_at`);
--> statement-breakpoint
CREATE TABLE `official_document` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`wp_media_id` integer NOT NULL,
	`title` text NOT NULL,
	`pdf_url` text NOT NULL,
	`published_at` integer NOT NULL,
	`circular_number` text,
	`season_label` text,
	`event_id` text,
	`mentions_fees` integer DEFAULT false NOT NULL,
	`reviewed_at` integer,
	`reviewed_by_profile_id` text,
	`file_hash` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "official_document_wp_media_id_integer" CHECK("wp_media_id" IS NULL OR (typeof("wp_media_id") = 'integer' AND "wp_media_id" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "official_document_published_at_integer" CHECK("published_at" IS NULL OR (typeof("published_at") = 'integer' AND "published_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "official_document_mentions_fees_boolean" CHECK("mentions_fees" IS NULL OR (typeof("mentions_fees") = 'integer' AND "mentions_fees" IN (0, 1))),
	CONSTRAINT "official_document_reviewed_at_integer" CHECK("reviewed_at" IS NULL OR (typeof("reviewed_at") = 'integer' AND "reviewed_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "official_document_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `official_document_wp_media_id_unique` ON `official_document` (`wp_media_id`);
--> statement-breakpoint
CREATE INDEX `official_document_published_idx` ON `official_document` (`published_at`);
--> statement-breakpoint
CREATE INDEX `official_document_sin_hash_idx` ON `official_document` (`id`) WHERE "file_hash" IS NULL;
--> statement-breakpoint
CREATE TABLE `official_ranking_entry` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`season_label` text NOT NULL,
	`skermo_season_id` text NOT NULL,
	`weapon` text NOT NULL,
	`gender` text NOT NULL,
	`category` text NOT NULL,
	`category_raw` text NOT NULL,
	`position` integer,
	`total_points` text,
	`athlete_id` text,
	`skermo_athlete_id` text,
	`source_license` text,
	`source_athlete_name` text NOT NULL,
	`source_first_name` text,
	`source_last_name` text,
	`source_club` text,
	`source_birth_date` text,
	`source_url` text,
	`content_hash` text NOT NULL,
	`ingested_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "official_ranking_entry_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "official_ranking_entry_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "official_ranking_entry_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "official_ranking_entry_position_integer" CHECK("position" IS NULL OR (typeof("position") = 'integer' AND "position" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "official_ranking_entry_ingested_at_integer" CHECK("ingested_at" IS NULL OR (typeof("ingested_at") = 'integer' AND "ingested_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "official_ranking_entry_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `official_ranking_entry_lookup_idx` ON `official_ranking_entry` (`season_label`,`weapon`,`gender`,`category`);
--> statement-breakpoint
CREATE INDEX `official_ranking_entry_athlete_idx` ON `official_ranking_entry` (`athlete_id`);
--> statement-breakpoint
CREATE INDEX `official_ranking_entry_skermo_idx` ON `official_ranking_entry` (`skermo_athlete_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `official_ranking_entry_key` ON `official_ranking_entry` (`skermo_season_id`,`weapon`,`gender`,`category_raw`,`skermo_athlete_id`);
--> statement-breakpoint
CREATE TABLE `profile_weapon` (
	`profile_id` text NOT NULL,
	`weapon` text NOT NULL,
	PRIMARY KEY(`profile_id`, `weapon`),
	FOREIGN KEY (`profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profile_weapon_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE'))
);

--> statement-breakpoint
CREATE TABLE `ranking_point` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`season_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`event_competition_id` text NOT NULL,
	`result_id` text,
	`position` integer NOT NULL,
	`base_points` text NOT NULL,
	`coefficient` text NOT NULL,
	`final_points` text NOT NULL,
	`counted` text DEFAULT '0' NOT NULL,
	`explanation` text,
	`computed_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_competition_id`) REFERENCES `event_competition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_id`) REFERENCES `result`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ranking_point_position_integer" CHECK("position" IS NULL OR (typeof("position") = 'integer' AND "position" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "ranking_point_computed_at_integer" CHECK("computed_at" IS NULL OR (typeof("computed_at") = 'integer' AND "computed_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `ranking_point_season_idx` ON `ranking_point` (`season_id`,`athlete_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ranking_point_key` ON `ranking_point` (`athlete_id`,`event_competition_id`);
--> statement-breakpoint
CREATE TABLE `ranking_rule` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`season_id` text NOT NULL,
	`weapon` text,
	`category` text,
	`counting_events` integer NOT NULL,
	`coefficients` text NOT NULL,
	`points_table` text NOT NULL,
	`points_formula` text,
	`previous_season_carry` text,
	`ranking_places` integer DEFAULT 0 NOT NULL,
	`technical_places` integer DEFAULT 0 NOT NULL,
	`cutoff_date` integer,
	`source_document` text,
	`source_url` text,
	`effective_from` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_by_profile_id` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ranking_rule_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "ranking_rule_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "ranking_rule_counting_events_integer" CHECK("counting_events" IS NULL OR (typeof("counting_events") = 'integer' AND "counting_events" BETWEEN -32768 AND 32767)),
	CONSTRAINT "ranking_rule_coefficients_json" CHECK("coefficients" IS NULL OR (typeof("coefficients") = 'text' AND json_valid("coefficients"))),
	CONSTRAINT "ranking_rule_points_table_json" CHECK("points_table" IS NULL OR (typeof("points_table") = 'text' AND json_valid("points_table"))),
	CONSTRAINT "ranking_rule_points_formula_json" CHECK("points_formula" IS NULL OR (typeof("points_formula") = 'text' AND json_valid("points_formula"))),
	CONSTRAINT "ranking_rule_ranking_places_integer" CHECK("ranking_places" IS NULL OR (typeof("ranking_places") = 'integer' AND "ranking_places" BETWEEN -32768 AND 32767)),
	CONSTRAINT "ranking_rule_technical_places_integer" CHECK("technical_places" IS NULL OR (typeof("technical_places") = 'integer' AND "technical_places" BETWEEN -32768 AND 32767)),
	CONSTRAINT "ranking_rule_cutoff_date_integer" CHECK("cutoff_date" IS NULL OR (typeof("cutoff_date") = 'integer' AND "cutoff_date" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "ranking_rule_effective_from_integer" CHECK("effective_from" IS NULL OR (typeof("effective_from") = 'integer' AND "effective_from" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "ranking_rule_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "ranking_rule_active_boolean" CHECK("active" IS NULL OR (typeof("active") = 'integer' AND "active" IN (0, 1)))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `ranking_rule_key` ON `ranking_rule` (`season_id`,`weapon`,`category`);
--> statement-breakpoint
CREATE TABLE `ranking_snapshot` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`season_id` text NOT NULL,
	`weapon` text NOT NULL,
	`gender` text NOT NULL,
	`category` text NOT NULL,
	`athlete_id` text NOT NULL,
	`position` integer NOT NULL,
	`total_points` text NOT NULL,
	`counted_event_ids` text NOT NULL,
	`computed_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ranking_snapshot_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "ranking_snapshot_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "ranking_snapshot_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "ranking_snapshot_position_integer" CHECK("position" IS NULL OR (typeof("position") = 'integer' AND "position" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "ranking_snapshot_counted_event_ids_json" CHECK("counted_event_ids" IS NULL OR (typeof("counted_event_ids") = 'text' AND json_valid("counted_event_ids"))),
	CONSTRAINT "ranking_snapshot_computed_at_integer" CHECK("computed_at" IS NULL OR (typeof("computed_at") = 'integer' AND "computed_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `ranking_snapshot_lookup_idx` ON `ranking_snapshot` (`season_id`,`weapon`,`gender`,`category`,`computed_at`);
--> statement-breakpoint
CREATE TABLE `result` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`event_competition_id` text,
	`event_id` text,
	`athlete_id` text,
	`source_athlete_name` text NOT NULL,
	`source_license` text,
	`source_club` text,
	`position` integer NOT NULL,
	`official_points` text,
	`weapon` text,
	`gender` text,
	`category` text,
	`source_url` text,
	`content_hash` text NOT NULL,
	`ingested_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`event_competition_id`) REFERENCES `event_competition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "result_position_integer" CHECK("position" IS NULL OR (typeof("position") = 'integer' AND "position" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "result_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "result_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "result_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "result_ingested_at_integer" CHECK("ingested_at" IS NULL OR (typeof("ingested_at") = 'integer' AND "ingested_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `result_athlete_idx` ON `result` (`athlete_id`);
--> statement-breakpoint
CREATE INDEX `result_unmatched_idx` ON `result` (`athlete_id`,`ingested_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_key` ON `result` (`event_competition_id`,`source_athlete_name`,`position`);
--> statement-breakpoint
CREATE TABLE `season` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`label` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	CONSTRAINT "season_is_current_boolean" CHECK("is_current" IS NULL OR (typeof("is_current") = 'integer' AND "is_current" IN (0, 1)))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `season_label_unique` ON `season` (`label`);
--> statement-breakpoint
CREATE TABLE `season_category` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`season_id` text NOT NULL,
	`code` text NOT NULL,
	`birth_year_min` integer,
	`birth_year_max` integer,
	`rank` integer NOT NULL,
	`is_laddered` integer DEFAULT true NOT NULL,
	`source_document` text,
	`source_url` text,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_by_profile_id` text,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "season_category_code_enum" CHECK("code" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "season_category_birth_year_min_integer" CHECK("birth_year_min" IS NULL OR (typeof("birth_year_min") = 'integer' AND "birth_year_min" BETWEEN -32768 AND 32767)),
	CONSTRAINT "season_category_birth_year_max_integer" CHECK("birth_year_max" IS NULL OR (typeof("birth_year_max") = 'integer' AND "birth_year_max" BETWEEN -32768 AND 32767)),
	CONSTRAINT "season_category_rank_integer" CHECK("rank" IS NULL OR (typeof("rank") = 'integer' AND "rank" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "season_category_is_laddered_boolean" CHECK("is_laddered" IS NULL OR (typeof("is_laddered") = 'integer' AND "is_laddered" IN (0, 1))),
	CONSTRAINT "season_category_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `season_category_key` ON `season_category` (`season_id`,`code`);
--> statement-breakpoint
CREATE TABLE `sport_bout` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`competition_id` text NOT NULL,
	`source` text NOT NULL,
	`phase` text NOT NULL,
	`round_key` text NOT NULL,
	`fencer_a_ref` text NOT NULL,
	`fencer_b_ref` text NOT NULL,
	`fencer_a_person_id` text,
	`fencer_b_person_id` text,
	`fencer_a_name` text NOT NULL,
	`fencer_b_name` text NOT NULL,
	`score_a` integer NOT NULL,
	`score_b` integer NOT NULL,
	`occurred_on` text,
	`source_url` text,
	`content_hash` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`revised_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `sport_competition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fencer_a_person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`fencer_b_person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_bout_canonical_order" CHECK("sport_bout"."fencer_a_ref" < "sport_bout"."fencer_b_ref"),
	CONSTRAINT "sport_bout_phase" CHECK("sport_bout"."phase" IN ('POULE','TABLEAU')),
	CONSTRAINT "sport_bout_scores" CHECK("sport_bout"."score_a" >= 0 AND "sport_bout"."score_b" >= 0),
	CONSTRAINT "sport_bout_distinct_people" CHECK("sport_bout"."fencer_a_person_id" IS NULL OR "sport_bout"."fencer_b_person_id" IS NULL OR "sport_bout"."fencer_a_person_id" <> "sport_bout"."fencer_b_person_id"),
	CONSTRAINT "sport_bout_score_a_integer" CHECK("score_a" IS NULL OR (typeof("score_a") = 'integer' AND "score_a" BETWEEN -32768 AND 32767)),
	CONSTRAINT "sport_bout_score_b_integer" CHECK("score_b" IS NULL OR (typeof("score_b") = 'integer' AND "score_b" BETWEEN -32768 AND 32767)),
	CONSTRAINT "sport_bout_revision_integer" CHECK("revision" IS NULL OR (typeof("revision") = 'integer' AND "revision" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "sport_bout_first_seen_at_integer" CHECK("first_seen_at" IS NULL OR (typeof("first_seen_at") = 'integer' AND "first_seen_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_bout_revised_at_integer" CHECK("revised_at" IS NULL OR (typeof("revised_at") = 'integer' AND "revised_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_bout_a_idx` ON `sport_bout` (`fencer_a_person_id`,`fencer_b_person_id`,`occurred_on`);
--> statement-breakpoint
CREATE INDEX `sport_bout_b_idx` ON `sport_bout` (`fencer_b_person_id`,`fencer_a_person_id`,`occurred_on`);
--> statement-breakpoint
CREATE INDEX `sport_bout_competition_idx` ON `sport_bout` (`competition_id`,`phase`,`round_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_bout_key` ON `sport_bout` (`competition_id`,`source`,`phase`,`round_key`,`fencer_a_ref`,`fencer_b_ref`);
--> statement-breakpoint
CREATE TABLE `sport_competition` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`edition_id` text NOT NULL,
	`source` text NOT NULL,
	`season` text NOT NULL,
	`competition_key` text NOT NULL,
	`weapon` text NOT NULL,
	`gender` text NOT NULL,
	`category` text NOT NULL,
	`category_raw` text,
	`format` text DEFAULT 'INDIVIDUAL' NOT NULL,
	`competition_date` text,
	`source_url` text,
	`event_competition_id` text,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`edition_id`) REFERENCES `sport_edition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_competition_id`) REFERENCES `event_competition`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_competition_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "sport_competition_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "sport_competition_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "sport_competition_format_enum" CHECK("format" IN ('INDIVIDUAL', 'EQUIPOS')),
	CONSTRAINT "sport_competition_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_competition_edition_idx` ON `sport_competition` (`edition_id`);
--> statement-breakpoint
CREATE INDEX `sport_competition_filter_idx` ON `sport_competition` (`weapon`,`gender`,`category`,`format`,`season`);
--> statement-breakpoint
CREATE INDEX `sport_competition_date_idx` ON `sport_competition` (`competition_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_competition_key` ON `sport_competition` (`source`,`season`,`competition_key`);
--> statement-breakpoint
CREATE TABLE `sport_edition` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`source` text NOT NULL,
	`season` text NOT NULL,
	`tournament_key` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`city` text,
	`country_code` text,
	`source_url` text,
	`event_id` text,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_edition_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_edition_dates_idx` ON `sport_edition` (`start_date`,`end_date`);
--> statement-breakpoint
CREATE INDEX `sport_edition_event_idx` ON `sport_edition` (`event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_edition_key` ON `sport_edition` (`source`,`season`,`tournament_key`);
--> statement-breakpoint
CREATE TABLE `sport_external_id` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`person_id` text,
	`scheme` text NOT NULL,
	`value` text NOT NULL,
	`scope_source` text NOT NULL,
	`scope_federation` text DEFAULT '' NOT NULL,
	`scope_season` text DEFAULT '' NOT NULL,
	`scope_weapon` text DEFAULT '' NOT NULL,
	`valid_from` text DEFAULT '1900-01-01' NOT NULL,
	`valid_to` text,
	`link_status` text DEFAULT 'PROPUESTO' NOT NULL,
	`linked_via` text,
	`linked_at` integer,
	`evidence` text,
	`decided_by_profile_id` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_external_id_confirmed_has_person" CHECK("sport_external_id"."link_status" <> 'CONFIRMADO' OR "sport_external_id"."person_id" IS NOT NULL),
	CONSTRAINT "sport_external_id_validity" CHECK("sport_external_id"."valid_to" IS NULL OR "sport_external_id"."valid_to" >= "sport_external_id"."valid_from"),
	CONSTRAINT "sport_external_id_scheme" CHECK("sport_external_id"."scheme" IN ('fie_addr_id','fie_license','rfee_license','skermo_athlete_id','pdf_ref')),
	CONSTRAINT "sport_external_id_link_status_enum" CHECK("link_status" IN ('PROPUESTO', 'CONFIRMADO', 'RECHAZADO')),
	CONSTRAINT "sport_external_id_linked_at_integer" CHECK("linked_at" IS NULL OR (typeof("linked_at") = 'integer' AND "linked_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_external_id_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_external_id_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `sport_external_id_confirmed_key` ON `sport_external_id` (`scheme`,`value`,`scope_source`,`scope_federation`,`scope_season`,`scope_weapon`,`valid_from`) WHERE "sport_external_id"."link_status" = 'CONFIRMADO';
--> statement-breakpoint
CREATE INDEX `sport_external_id_lookup_idx` ON `sport_external_id` (`scheme`,`value`,`scope_source`);
--> statement-breakpoint
CREATE INDEX `sport_external_id_person_idx` ON `sport_external_id` (`person_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_external_id_person_key` ON `sport_external_id` (`person_id`,`scheme`,`value`,`scope_source`,`scope_federation`,`scope_season`,`scope_weapon`,`valid_from`);
--> statement-breakpoint
CREATE TABLE `sport_favorite` (
	`profile_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	PRIMARY KEY(`profile_id`, `person_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sport_favorite_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_favorite_profile_idx` ON `sport_favorite` (`profile_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `sport_favorite_person_idx` ON `sport_favorite` (`person_id`);
--> statement-breakpoint
CREATE TABLE `sport_import_coverage` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`source` text NOT NULL,
	`season` text NOT NULL,
	`fact_kind` text NOT NULL,
	`competition_key` text DEFAULT '' NOT NULL,
	`competition_id` text,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`published_total` integer,
	`imported_total` integer DEFAULT 0 NOT NULL,
	`cursor` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`source_url` text,
	`last_checked_at` integer,
	`last_error` text,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `sport_competition`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_import_coverage_counts" CHECK("sport_import_coverage"."imported_total" >= 0 AND "sport_import_coverage"."attempts" >= 0),
	CONSTRAINT "sport_import_coverage_status_enum" CHECK("status" IN ('pendiente', 'completo', 'parcial', 'sin_resultados', 'error', 'conflicto')),
	CONSTRAINT "sport_import_coverage_published_total_integer" CHECK("published_total" IS NULL OR (typeof("published_total") = 'integer' AND "published_total" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "sport_import_coverage_imported_total_integer" CHECK("imported_total" IS NULL OR (typeof("imported_total") = 'integer' AND "imported_total" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "sport_import_coverage_attempts_integer" CHECK("attempts" IS NULL OR (typeof("attempts") = 'integer' AND "attempts" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "sport_import_coverage_last_checked_at_integer" CHECK("last_checked_at" IS NULL OR (typeof("last_checked_at") = 'integer' AND "last_checked_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_import_coverage_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_import_coverage_status_idx` ON `sport_import_coverage` (`status`,`source`,`season`);
--> statement-breakpoint
CREATE INDEX `sport_import_coverage_competition_idx` ON `sport_import_coverage` (`competition_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_import_coverage_key` ON `sport_import_coverage` (`source`,`season`,`fact_kind`,`competition_key`);
--> statement-breakpoint
CREATE TABLE `sport_incremental_task` (
	`key` text PRIMARY KEY NOT NULL,
	`season` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`next_check_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`last_checked_at` integer,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sport_incremental_kind" CHECK("sport_incremental_task"."kind" in ('fie_index','rfee_index','fie_result','rfee_result','rfee_pdf','fie_standing','rfee_standing','cooldown')),
	CONSTRAINT "sport_incremental_task_payload_json" CHECK("payload" IS NULL OR (typeof("payload") = 'text' AND json_valid("payload"))),
	CONSTRAINT "sport_incremental_task_next_check_at_integer" CHECK("next_check_at" IS NULL OR (typeof("next_check_at") = 'integer' AND "next_check_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_incremental_task_last_checked_at_integer" CHECK("last_checked_at" IS NULL OR (typeof("last_checked_at") = 'integer' AND "last_checked_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_incremental_task_attempts_integer" CHECK("attempts" IS NULL OR (typeof("attempts") = 'integer' AND "attempts" BETWEEN -2147483648 AND 2147483647))
);

--> statement-breakpoint
CREATE INDEX `sport_incremental_due_idx` ON `sport_incremental_task` (`season`,`next_check_at`);
--> statement-breakpoint
CREATE TABLE `sport_link_candidate` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`source` text NOT NULL,
	`source_ref` text NOT NULL,
	`source_name` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text DEFAULT 'PROPUESTO' NOT NULL,
	`evidence` text,
	`decided_by_profile_id` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_link_candidate_status_enum" CHECK("status" IN ('PROPUESTO', 'CONFIRMADO', 'RECHAZADO')),
	CONSTRAINT "sport_link_candidate_decided_at_integer" CHECK("decided_at" IS NULL OR (typeof("decided_at") = 'integer' AND "decided_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_link_candidate_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_link_candidate_open_idx` ON `sport_link_candidate` (`status`,`source`);
--> statement-breakpoint
CREATE INDEX `sport_link_candidate_person_idx` ON `sport_link_candidate` (`person_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_link_candidate_key` ON `sport_link_candidate` (`source`,`source_ref`,`person_id`);
--> statement-breakpoint
CREATE TABLE `sport_person` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`athlete_id` text,
	`athlete_linked_via` text,
	`athlete_linked_at` integer,
	`athlete_link_evidence` text,
	`display_name` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`name_normalized` text NOT NULL,
	`gender` text,
	`country_code` text,
	`birth_year` integer,
	`merged_into_person_id` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`athlete_id`) REFERENCES `athlete`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`merged_into_person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_person_no_self_merge" CHECK("merged_into_person_id" IS NOT "id"),
	CONSTRAINT "sport_person_athlete_linked_at_integer" CHECK("athlete_linked_at" IS NULL OR (typeof("athlete_linked_at") = 'integer' AND "athlete_linked_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_person_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "sport_person_birth_year_integer" CHECK("birth_year" IS NULL OR (typeof("birth_year") = 'integer' AND "birth_year" BETWEEN -32768 AND 32767)),
	CONSTRAINT "sport_person_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_person_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `sport_person_athlete_key` ON `sport_person` (`athlete_id`) WHERE "sport_person"."athlete_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `sport_person_name_idx` ON `sport_person` (`name_normalized`);
--> statement-breakpoint
CREATE INDEX `sport_person_merged_idx` ON `sport_person` (`merged_into_person_id`);
--> statement-breakpoint
CREATE TABLE `sport_person_alias` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`person_id` text NOT NULL,
	`source` text NOT NULL,
	`name_original` text NOT NULL,
	`name_normalized` text NOT NULL,
	`first_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sport_person_alias_first_seen_at_integer" CHECK("first_seen_at" IS NULL OR (typeof("first_seen_at") = 'integer' AND "first_seen_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_person_alias_name_idx` ON `sport_person_alias` (`name_normalized`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_person_alias_key` ON `sport_person_alias` (`person_id`,`source`,`name_normalized`);
--> statement-breakpoint
CREATE TABLE `sport_ranking_entry` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`publication_id` text NOT NULL,
	`source_ref` text NOT NULL,
	`person_id` text,
	`source_name` text,
	`country_code` text,
	`position` integer,
	`points` text,
	FOREIGN KEY (`publication_id`) REFERENCES `sport_ranking_publication`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_ranking_entry_position_integer" CHECK("position" IS NULL OR (typeof("position") = 'integer' AND "position" BETWEEN -2147483648 AND 2147483647))
);

--> statement-breakpoint
CREATE INDEX `sport_ranking_entry_person_idx` ON `sport_ranking_entry` (`person_id`,`publication_id`);
--> statement-breakpoint
CREATE INDEX `sport_ranking_entry_position_idx` ON `sport_ranking_entry` (`publication_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_ranking_entry_key` ON `sport_ranking_entry` (`publication_id`,`source_ref`);
--> statement-breakpoint
CREATE TABLE `sport_ranking_publication` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`source` text NOT NULL,
	`season` text NOT NULL,
	`weapon` text NOT NULL,
	`gender` text NOT NULL,
	`category` text NOT NULL,
	`category_raw` text NOT NULL,
	`format` text DEFAULT 'INDIVIDUAL' NOT NULL,
	`published_on` text NOT NULL,
	`date_basis` text DEFAULT 'observed' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`source_url` text,
	`published_total` integer,
	`fetched_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	CONSTRAINT "sport_ranking_publication_weapon_enum" CHECK("weapon" IN ('FLORETE', 'ESPADA', 'SABLE')),
	CONSTRAINT "sport_ranking_publication_gender_enum" CHECK("gender" IN ('M', 'F', 'MIXTO')),
	CONSTRAINT "sport_ranking_publication_category_enum" CHECK("category" IN ('M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET')),
	CONSTRAINT "sport_ranking_publication_format_enum" CHECK("format" IN ('INDIVIDUAL', 'EQUIPOS')),
	CONSTRAINT "sport_ranking_publication_revision_integer" CHECK("revision" IS NULL OR (typeof("revision") = 'integer' AND "revision" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "sport_ranking_publication_published_total_integer" CHECK("published_total" IS NULL OR (typeof("published_total") = 'integer' AND "published_total" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "sport_ranking_publication_fetched_at_integer" CHECK("fetched_at" IS NULL OR (typeof("fetched_at") = 'integer' AND "fetched_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_ranking_publication_lookup_idx` ON `sport_ranking_publication` (`season`,`weapon`,`gender`,`category`,`published_on`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_ranking_publication_key` ON `sport_ranking_publication` (`source`,`season`,`weapon`,`gender`,`category_raw`,`format`,`published_on`);
--> statement-breakpoint
CREATE TABLE `sport_registration_ref` (
	`registration_id` text NOT NULL,
	`scheme` text NOT NULL,
	`value` text NOT NULL,
	`scope_source` text NOT NULL,
	`scope_federation` text DEFAULT '' NOT NULL,
	`scope_season` text DEFAULT '' NOT NULL,
	`scope_weapon` text DEFAULT '' NOT NULL,
	`observed_on` text,
	`last_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	PRIMARY KEY(`registration_id`, `scheme`, `value`, `scope_source`, `scope_federation`, `scope_season`, `scope_weapon`),
	FOREIGN KEY (`registration_id`) REFERENCES `competition_registration`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sport_registration_ref_scheme" CHECK("sport_registration_ref"."scheme" IN ('fie_addr_id','fie_license','rfee_license','skermo_athlete_id','pdf_ref')),
	CONSTRAINT "sport_registration_ref_last_seen_at_integer" CHECK("last_seen_at" IS NULL OR (typeof("last_seen_at") = 'integer' AND "last_seen_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_registration_ref_value_idx` ON `sport_registration_ref` (`scheme`,`value`);
--> statement-breakpoint
CREATE TABLE `sport_result` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`competition_id` text NOT NULL,
	`source` text NOT NULL,
	`source_fact_key` text NOT NULL,
	`person_id` text,
	`source_name` text NOT NULL,
	`source_country_code` text,
	`source_club` text,
	`position` integer,
	`position_raw` text,
	`official_points` text,
	`occurred_on` text,
	`source_url` text,
	`content_hash` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`revised_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `sport_competition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `sport_person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sport_result_position_positive" CHECK("sport_result"."position" IS NULL OR "sport_result"."position" > 0),
	CONSTRAINT "sport_result_position_integer" CHECK("position" IS NULL OR (typeof("position") = 'integer' AND "position" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "sport_result_revision_integer" CHECK("revision" IS NULL OR (typeof("revision") = 'integer' AND "revision" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "sport_result_first_seen_at_integer" CHECK("first_seen_at" IS NULL OR (typeof("first_seen_at") = 'integer' AND "first_seen_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "sport_result_revised_at_integer" CHECK("revised_at" IS NULL OR (typeof("revised_at") = 'integer' AND "revised_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE INDEX `sport_result_person_date_idx` ON `sport_result` (`person_id`,`occurred_on`);
--> statement-breakpoint
CREATE INDEX `sport_result_competition_position_idx` ON `sport_result` (`competition_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_result_key` ON `sport_result` (`competition_id`,`source`,`source_fact_key`);
--> statement-breakpoint
CREATE TABLE `sport_write_lease` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "sport_write_lease_global" CHECK("sport_write_lease"."key" = 'global'),
	CONSTRAINT "sport_write_lease_expires_at_integer" CHECK("expires_at" IS NULL OR (typeof("expires_at") = 'integer' AND "expires_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE TABLE `submission` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`entry_id` text NOT NULL,
	`status` text DEFAULT 'dry_run' NOT NULL,
	`request_snapshot` text,
	`response_status` integer,
	`response_snapshot` text,
	`verified_at` integer,
	`verification_note` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`triggered_by_profile_id` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "submission_status_enum" CHECK("status" IN ('dry_run', 'sent', 'verified', 'failed')),
	CONSTRAINT "submission_request_snapshot_json" CHECK("request_snapshot" IS NULL OR (typeof("request_snapshot") = 'text' AND json_valid("request_snapshot"))),
	CONSTRAINT "submission_response_status_integer" CHECK("response_status" IS NULL OR (typeof("response_status") = 'integer' AND "response_status" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "submission_verified_at_integer" CHECK("verified_at" IS NULL OR (typeof("verified_at") = 'integer' AND "verified_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "submission_attempts_integer" CHECK("attempts" IS NULL OR (typeof("attempts") = 'integer' AND "attempts" BETWEEN -2147483648 AND 2147483647)),
	CONSTRAINT "submission_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "submission_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `submission_entry_id_unique` ON `submission` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `submission_status_idx` ON `submission` (`status`);
--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`auth_user_id` text,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'athlete' NOT NULL,
	`club_id` text,
	`phone` text,
	`invite_status` text DEFAULT 'pendiente' NOT NULL,
	`invited_at` integer,
	`ical_token` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000 + cast(substr(strftime('%f', 'now'), 4, 3) as integer)) NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `club`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_profile_role_enum" CHECK("role" IN ('admin', 'coach', 'club', 'athlete', 'guardian')),
	CONSTRAINT "user_profile_invite_status_enum" CHECK("invite_status" IN ('pendiente', 'aceptada', 'revocada')),
	CONSTRAINT "user_profile_invited_at_integer" CHECK("invited_at" IS NULL OR (typeof("invited_at") = 'integer' AND "invited_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "user_profile_created_at_integer" CHECK("created_at" IS NULL OR (typeof("created_at") = 'integer' AND "created_at" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "user_profile_updated_at_integer" CHECK("updated_at" IS NULL OR (typeof("updated_at") = 'integer' AND "updated_at" BETWEEN -9007199254740991 AND 9007199254740991))
);

--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_auth_user_id_unique` ON `user_profile` (`auth_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_email_unique` ON `user_profile` (`email`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_ical_token_unique` ON `user_profile` (`ical_token`);
--> statement-breakpoint
CREATE INDEX `user_profile_club_idx` ON `user_profile` (`club_id`);
