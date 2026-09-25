ALTER TYPE "public"."user_role" ADD VALUE 'coach' BEFORE 'club';--> statement-breakpoint
CREATE TABLE "profile_weapon" (
	"profile_id" uuid NOT NULL,
	"weapon" "weapon" NOT NULL,
	CONSTRAINT "profile_weapon_profile_id_weapon_pk" PRIMARY KEY("profile_id","weapon")
);
--> statement-breakpoint
ALTER TABLE "profile_weapon" ADD CONSTRAINT "profile_weapon_profile_id_user_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;