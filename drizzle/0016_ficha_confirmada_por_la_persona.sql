-- Quién vinculó una ficha, cómo y cuándo.
--
-- Hasta ahora esto solo se sabía leyendo `athlete.notes`, que es una frase en
-- castellano: sirve para que un humano lo lea en /admin/usuarios, pero no para
-- responder «¿qué fichas se vincularon sin comprobar la licencia?», que es
-- exactamente la pregunta que hay que poder contestar desde que `/alta` deja
-- que alguien se reconozca por su nombre.
--
-- `linked_via` usa el mismo vocabulario que `fie_fencer.linked_via`, que ya
-- distinguía «licencia_fie» de «persona», para no tener dos jergas para lo
-- mismo:
--   'licencia_rfee'      la licencia del carné coincidió con la de la fuente
--   'persona'            la propia persona se reconoció por su nombre y pulsó
--                        «Sí, soy yo». `linked_by_profile_id` es su cuenta.
--   'direccion_tecnica'  la creó un administrador o el guion de altas.
--
-- `linked_evidence` guarda lo que se escribió en el buscador y qué fila de qué
-- fuente se reclamó. Sin eso, un enlace confirmado por la persona no se puede
-- auditar: quedaría la fecha pero no lo que vio antes de pulsar.
ALTER TABLE "athlete" ADD COLUMN IF NOT EXISTS "linked_via" text;
--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN IF NOT EXISTS "linked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN IF NOT EXISTS "linked_by_profile_id" uuid;
--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN IF NOT EXISTS "linked_evidence" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "athlete" ADD CONSTRAINT "athlete_linked_by_profile_id_user_profile_id_fk"
    FOREIGN KEY ("linked_by_profile_id") REFERENCES "user_profile"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
