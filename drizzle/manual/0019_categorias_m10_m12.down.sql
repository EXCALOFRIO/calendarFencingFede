-- Retorno de 0019: PostgreSQL no permite quitar un valor de un enum.
-- No hay nada que revertir sin reconstruir el tipo: los valores M10 y M12
-- sobrantes no alteran ninguna fila existente y pueden dejarse. Si se hubiera
-- importado alguna prueba M10/M12, borrar antes esas filas de `sport_*`.
-- Quitar también la fila de 0019 de drizzle.__drizzle_migrations si se revierte.
SELECT 1;
