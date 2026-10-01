-- M10 y M12: etiquetas de categoría que publican clasificaciones históricas de
-- Skermo (índice de resultados y cabecera de la clasificación).
--
-- SOLO ADITIVA y sin tocar datos: añade dos valores a `category_code` para
-- poder guardar la categoría tal como la publica la fuente en las tablas
-- `sport_*`. No crea reglas de edad ni de elegibilidad, y la ingesta del
-- cálculo interno (`result`, `ranking_snapshot`, `ranking_point`) sigue sin
-- aceptarlas. Sin esta migración, las pruebas M10/M12 se quedan sin importar
-- con el aviso «esquema no aplicado»; nunca se guardan como otra categoría.
--
-- `BEFORE` para que los selectores las ofrezcan en su sitio (M9, M10, M11, M12,
-- M13). Cada valor va en su propia sentencia y no se usa dentro de esta misma
-- transacción. NO se ha aplicado a ninguna base: revisar y aplicar a mano.
ALTER TYPE "category_code" ADD VALUE IF NOT EXISTS 'M10' BEFORE 'M11';
--> statement-breakpoint
ALTER TYPE "category_code" ADD VALUE IF NOT EXISTS 'M12' BEFORE 'M13';
