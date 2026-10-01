-- Retorno de 0017: solo elimina objetos creados por esa migración.
-- Quitar también la fila de 0017 de drizzle.__drizzle_migrations si se revierte.
DROP TABLE IF EXISTS "sport_import_coverage";
DROP TABLE IF EXISTS "sport_favorite";
DROP TABLE IF EXISTS "sport_ranking_entry";
DROP TABLE IF EXISTS "sport_ranking_publication";
DROP TABLE IF EXISTS "sport_bout";
DROP TABLE IF EXISTS "sport_result";
DROP TABLE IF EXISTS "sport_competition";
DROP TABLE IF EXISTS "sport_edition";
DROP TABLE IF EXISTS "sport_link_candidate";
DROP TABLE IF EXISTS "sport_external_id";
DROP TABLE IF EXISTS "sport_person_alias";
DROP TABLE IF EXISTS "sport_person";
DROP TYPE IF EXISTS "sport_coverage_status";
DROP TYPE IF EXISTS "sport_link_status";

