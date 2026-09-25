ALTER TABLE "official_ranking_entry" DROP CONSTRAINT "official_ranking_entry_key";--> statement-breakpoint
ALTER TABLE "official_ranking_entry" ALTER COLUMN "position" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "official_ranking_entry" ADD CONSTRAINT "official_ranking_entry_key" UNIQUE("skermo_season_id","weapon","gender","category_raw","skermo_athlete_id");