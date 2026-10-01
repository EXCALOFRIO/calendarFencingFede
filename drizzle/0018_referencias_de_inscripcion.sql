-- Referencias publicadas (ID FIE, licencia) de cada inscrito, con ámbito y día.
--
-- SOLO ADITIVA: crea una tabla nueva, `sport_registration_ref`, con clave ajena
-- hacia `competition_registration`. No altera ninguna tabla existente, de modo
-- que el código sigue funcionando con o sin ella: sólo la lee y escribe cuando
-- existe. Es independiente de 0017 (no referencia tablas `sport_*`), aunque el
-- lector sólo cruza estas referencias con `sport_external_id` si 0017 está.
--
-- NO se ha aplicado a ninguna base. Revisar y aplicar a mano; el retorno está en
-- drizzle/manual/0018_referencias_de_inscripcion.down.sql (solo borra la tabla
-- nueva; las referencias se vuelven a poblar en la siguiente lectura de listas).
CREATE TABLE IF NOT EXISTS "sport_registration_ref" (
	"registration_id" uuid NOT NULL,
	"scheme" text NOT NULL,
	"value" text NOT NULL,
	"scope_source" text NOT NULL,
	"scope_federation" text DEFAULT '' NOT NULL,
	"scope_season" text DEFAULT '' NOT NULL,
	"scope_weapon" text DEFAULT '' NOT NULL,
	"observed_on" date,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sport_registration_ref_pk" PRIMARY KEY("registration_id","scheme","value","scope_source","scope_federation","scope_season","scope_weapon"),
	CONSTRAINT "sport_registration_ref_scheme" CHECK ("sport_registration_ref"."scheme" IN ('fie_addr_id','fie_license','rfee_license','skermo_athlete_id','pdf_ref'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sport_registration_ref" ADD CONSTRAINT "sport_registration_ref_registration_id_competition_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."competition_registration"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sport_registration_ref_value_idx" ON "sport_registration_ref" USING btree ("scheme","value");
