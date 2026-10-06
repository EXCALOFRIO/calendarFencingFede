-- «En directo / Resultados» links on the calendar (src/lib/ingest/directos.ts, src/lib/queries/calendar.ts).
-- Apply after 0007 and BEFORE deploying the code that reads live_source.match_rule.
-- Additive only: the code deployed today selects its own columns and keeps working.
--
-- match_rule records how a link was attributed: 'fie_competicion', 'skermo_indice',
-- 'engarde_rfee:fecha_ciudad_prueba', 'engarde_rfee:fecha_prueba_unica', or the source's
-- own publication ('fie_publicado'). NULL on rows written before this migration.
--
-- HOW TO APPLY: only as a whole file with `wrangler d1 execute <db> --remote --file
-- drizzle-d1/0008_enlaces_directo.sql`, which runs it in one transaction. The ALTER TABLE below
-- cannot be repeated, so never paste statements one by one: if the command fails, nothing was
-- applied and the whole file is retried.
--
-- No DELETE here touches hand-pasted links (is_automatic = 0).
ALTER TABLE live_source ADD COLUMN match_rule text;

-- URLs below are compared the way normalizarUrlDirecto() does for the common cases: trimmed and
-- without the fragment (the FIE publishes '...#today'). The new writer compares the full
-- normalisation, so anything this misses is cleaned up on its next pass.

-- live_source_key is UNIQUE (event_id, event_competition_id, url), but SQLite never treats two
-- NULLs as equal, so tournament-level links (event_competition_id NULL) were re-inserted on every
-- cron run. Keep one copy of each, a hand-pasted one first and then the oldest; only automatic
-- copies are deleted. The new writer checks before inserting.
DELETE FROM live_source
 WHERE is_automatic = 1
   AND rowid IN (
     SELECT rid FROM (
       SELECT rowid AS rid,
              row_number() OVER (
                PARTITION BY event_id, coalesce(event_competition_id, ''),
                  CASE WHEN instr(trim(url), '#') > 0 THEN substr(trim(url), 1, instr(trim(url), '#') - 1) ELSE trim(url) END
                ORDER BY is_automatic, rowid
              ) AS rn
         FROM live_source
     ) WHERE rn > 1
   );

-- The old FIE and Skermo-index writers stored the link of ONE competition with
-- event_competition_id NULL. Where the same event already has that URL on a competition, the
-- NULL copy is not a tournament link: drop it. Hand-pasted links (is_automatic = 0) are kept.
DELETE FROM live_source
 WHERE event_competition_id IS NULL AND is_automatic = 1
   AND EXISTS (
     SELECT 1 FROM live_source o
      WHERE o.event_id = live_source.event_id AND o.event_competition_id IS NOT NULL
        AND CASE WHEN instr(trim(o.url), '#') > 0 THEN substr(trim(o.url), 1, instr(trim(o.url), '#') - 1) ELSE trim(o.url) END
          = CASE WHEN instr(trim(live_source.url), '#') > 0 THEN substr(trim(live_source.url), 1, instr(trim(live_source.url), '#') - 1) ELSE trim(live_source.url) END
   );

-- FIE events carry one competition each: their old NULL links belong to it.
UPDATE OR IGNORE live_source
   SET event_competition_id = (SELECT c.id FROM event_competition c WHERE c.event_id = live_source.event_id),
       url = CASE WHEN instr(trim(url), '#') > 0 THEN substr(trim(url), 1, instr(trim(url), '#') - 1) ELSE trim(url) END,
       match_rule = 'fie_publicado'
 WHERE event_competition_id IS NULL AND is_automatic = 1 AND match_rule IS NULL
   AND event_id IN (SELECT id FROM event WHERE source = 'fie')
   AND (SELECT count(*) FROM event_competition c WHERE c.event_id = live_source.event_id) = 1;

-- Old Skermo results-index links (identified by their labels): one competition's URL stored
-- without it. With a single competition it is that one's. With several, the competition cannot
-- be recovered here and old tournaments are no longer in the index, so the row stays as the
-- tournament's link; if the index lists it again, the writer moves it to its competition.
UPDATE OR IGNORE live_source
   SET event_competition_id = (SELECT c.id FROM event_competition c WHERE c.event_id = live_source.event_id),
       match_rule = 'skermo_indice'
 WHERE event_competition_id IS NULL AND is_automatic = 1 AND match_rule IS NULL
   AND label IN ('Resultados en Engarde', 'Resultados en Fencing Time Live')
   AND (SELECT count(*) FROM event_competition c WHERE c.event_id = live_source.event_id) = 1;

-- ON DELETE CASCADE from event_competition, and the per-competition lookup in the calendar.
CREATE INDEX IF NOT EXISTS live_source_competition_idx ON live_source (event_competition_id);
