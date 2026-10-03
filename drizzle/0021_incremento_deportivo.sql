-- Apply ONLY after every pre-lease sport writer has stopped. No historical re-crawl.
CREATE TABLE "public"."sport_write_lease" (
  "key" text PRIMARY KEY,
  "owner" uuid NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "sport_write_lease_global" CHECK ("key" = 'global')
);
--> statement-breakpoint
CREATE TABLE "public"."sport_incremental_task" (
  "key" text PRIMARY KEY,
  "season" text NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "next_check_at" timestamptz NOT NULL DEFAULT now(),
  "last_checked_at" timestamptz,
  "status" text NOT NULL DEFAULT 'pendiente',
  "attempts" integer NOT NULL DEFAULT 0,
  CONSTRAINT "sport_incremental_kind" CHECK ("kind" IN ('fie_index','rfee_index','fie_result','rfee_result','rfee_pdf','fie_standing','rfee_standing','cooldown'))
);
--> statement-breakpoint
CREATE INDEX "sport_incremental_due_idx" ON "public"."sport_incremental_task" ("season", "next_check_at");
--> statement-breakpoint
ALTER TABLE "public"."sport_ranking_publication"
  ADD COLUMN "date_basis" text NOT NULL DEFAULT 'observed',
  ADD COLUMN "revision" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
-- Row lock is held to COMMIT. Acquisition/renewal/release cannot pass an in-flight
-- writer, even if its expiry passes while a statement is still running.
CREATE FUNCTION "public"."sport_require_write_lease"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE held public.sport_write_lease%ROWTYPE;
BEGIN
  SELECT * INTO held FROM public.sport_write_lease WHERE key = 'global' FOR UPDATE;
  IF NOT FOUND OR held.owner::text IS DISTINCT FROM current_setting('app.sport_write_owner', true)
    OR held.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'sport write lease required' USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'sport_person','sport_person_alias','sport_external_id','sport_link_candidate',
    'sport_edition','sport_competition','sport_result','sport_bout',
    'sport_ranking_publication','sport_ranking_entry','sport_import_coverage',
    'sport_incremental_task'
  ] LOOP
    EXECUTE format('CREATE TRIGGER sport_corpus_write_lease BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.sport_require_write_lease()', tab);
  END LOOP;
END;
$$;
