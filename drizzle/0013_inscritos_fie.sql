-- Las listas de inscritos de la FIE, con lo justo y nada más.
--
-- QUÉ SE GUARDA Y QUÉ NO, que es la decisión que manda sobre estas columnas
-- ------------------------------------------------------------------------
-- De cada lista de la FIE se guarda, y SOLO de los tiradores `ESP`: el nombre
-- publicado, la licencia y el día de inscripción. Se descarta sin llegar a
-- escribirse: fecha de nacimiento, edad, altura, foto y cualquier fila que no
-- sea española. El filtro vive en el adaptador
-- (`inscritosEspanolesDeLaFie`, en `src/lib/ingest/sources/fie.ts`) y tiene su
-- test con un menor de otra federación: un `if` con un caso no se salta, una
-- regla escrita en un comentario sí.
--
-- `source_registered_at` es el tercero de esos tres campos. Es un DÍA de
-- calendario del publicador ("registeredAt": "2026-09-08"), no un instante
-- nuestro: `first_seen_at` ya dice cuándo lo vimos aquí, y las dos preguntas
-- —«¿desde cuándo estoy apuntado?» y «¿desde cuándo lo sabemos?»— son
-- distintas.
ALTER TABLE "competition_registration" ADD COLUMN IF NOT EXISTS "source_registered_at" date;
--> statement-breakpoint

-- EL COSTE, que es el otro motivo de esta migración.
--
-- La lista de inscritos es UNA PETICIÓN POR PRUEBA y hay 102 pruebas
-- internacionales por delante. Medido contra su API el 27/09/2026: más allá de
-- 30 días la lista está a medias y **no hay ni un español** (0 en 48 pruebas
-- entre D+31 y D+90), así que la ventana se cierra en 30 días y son 54
-- peticiones en vez de 102.
--
-- Estas dos columnas son lo que evita pagar esas 54 en cada pasada:
--
--  · `registrations_checked_at` deja que `tocaLeerInscritos` decida si toca
--    leer. Una segunda pasada el mismo día cuesta 0 peticiones.
--  · `registrations_hash` deja que una lista que no ha cambiado NO reescriba
--    ni una fila. Va aparte de `content_hash` a propósito: si la lista entrase
--    en el hash de la prueba, cada persona que se apunta marcaría la prueba
--    como «modificada» y el registro de cambios —que dispara los avisos por
--    correo— dejaría de significar nada.
ALTER TABLE "event_competition" ADD COLUMN IF NOT EXISTS "registrations_hash" text;
--> statement-breakpoint
ALTER TABLE "event_competition" ADD COLUMN IF NOT EXISTS "registrations_checked_at" timestamp with time zone;
