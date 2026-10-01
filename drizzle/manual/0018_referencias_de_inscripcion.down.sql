-- Retorno de 0018: solo elimina la tabla creada por esa migración.
-- Quitar también la fila de 0018 de drizzle.__drizzle_migrations si se revierte.
DROP TABLE IF EXISTS "sport_registration_ref";
