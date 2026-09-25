CREATE TYPE "public"."event_link_status" AS ENUM('AUTOMATICO', 'DUDOSO', 'CONFIRMADO', 'RECHAZADO');--> statement-breakpoint
CREATE TABLE "event_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_event_id" uuid NOT NULL,
	"linked_event_id" uuid NOT NULL,
	"status" "event_link_status" DEFAULT 'AUTOMATICO' NOT NULL,
	"city_key" text,
	"rule" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_profile_id" uuid,
	CONSTRAINT "event_link_key" UNIQUE("canonical_event_id","linked_event_id")
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "canonical_event_id" uuid;--> statement-breakpoint
ALTER TABLE "event_link" ADD CONSTRAINT "event_link_canonical_event_id_event_id_fk" FOREIGN KEY ("canonical_event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_link" ADD CONSTRAINT "event_link_linked_event_id_event_id_fk" FOREIGN KEY ("linked_event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_link" ADD CONSTRAINT "event_link_decided_by_profile_id_user_profile_id_fk" FOREIGN KEY ("decided_by_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_link_linked_idx" ON "event_link" USING btree ("linked_event_id");--> statement-breakpoint
CREATE INDEX "event_link_status_idx" ON "event_link" USING btree ("status");--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_canonical_event_id_event_id_fk" FOREIGN KEY ("canonical_event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_canonical_idx" ON "event" USING btree ("canonical_event_id");