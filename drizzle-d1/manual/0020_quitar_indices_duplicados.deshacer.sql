-- Inverse of 0020_quitar_indices_duplicados.sql (same definitions as 0000_aplicacion.sql).
-- Reads all 1.56 M rows of sport_bout to rebuild the index; DDL, so no sport_* trigger fires.
-- If src/db/d1/schema.ts and src/db/schema/sport.ts no longer declare them, add them back there too.
CREATE INDEX IF NOT EXISTS `sport_bout_competition_idx` ON `sport_bout` (`competition_id`,`phase`,`round_key`);
CREATE INDEX IF NOT EXISTS `sport_external_id_person_idx` ON `sport_external_id` (`person_id`);
