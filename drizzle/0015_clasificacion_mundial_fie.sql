-- La clasificación mundial de la FIE: individual y por selecciones.
--
-- Autocontenida a propósito: NO enlaza con `fie_fencer`. Esa tabla es el
-- índice de los tiradores que nos importan, con su ficha, su foto y su estado
-- de enlace; meter aquí los 10.762 del mundo la convertiría en un censo
-- mundial. Ver la cabecera de la tabla en `src/db/schema/fie.ts`.
--
-- Volumen medido el 28/09/2026 (temporada 2027, 24 combinaciones):
--   individual   10.762 filas   2,6 MB
--   selecciones     753 filas   0,2 MB
CREATE TABLE IF NOT EXISTS "fie_clasificacion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "season" integer NOT NULL,
  "weapon" "weapon" NOT NULL,
  "gender" "gender" NOT NULL,
  "category" "category_code" NOT NULL,
  "category_raw" text NOT NULL,
  "format" "competition_format" NOT NULL,
  "fie_id" integer NOT NULL,
  "position" integer,
  "points" numeric(10, 3),
  "source_name" text,
  "country_code" text,
  "country_name" text,
  "event_count" integer,
  "source_url" text,
  "content_hash" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- El sitio en la clasificación, que es la clave natural. El puesto NO entra:
-- cambia cada semana y cada actualización insertaría una fila nueva.
CREATE UNIQUE INDEX IF NOT EXISTS "fie_clasificacion_key"
  ON "fie_clasificacion" ("season", "weapon", "gender", "category_raw", "format", "fie_id");

-- Con el que se pinta la tabla: un grupo entero, ordenado por puesto.
CREATE INDEX IF NOT EXISTS "fie_clasificacion_grupo_idx"
  ON "fie_clasificacion" ("season", "format", "weapon", "gender", "category", "position");

-- Y el del filtro «solo España».
CREATE INDEX IF NOT EXISTS "fie_clasificacion_pais_idx"
  ON "fie_clasificacion" ("country_code");
