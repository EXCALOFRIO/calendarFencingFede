-- Index for the calendar's past-results cross-reference (src/lib/queries/calendario-pasado.ts).
-- Apply after 0005. Read-only for the app: it adds no table, column, trigger or constraint,
-- and touches no sport_* row, so the write fence and the capacity ledger are not involved.
--
-- Without it, the branch that follows sport_competition.event_competition_id makes SQLite
-- build an AUTOMATIC COVERING INDEX over the whole of sport_competition on every request
-- (measured on the working copy: 14,477 rows scanned to look up a few dozen ids).
-- The column is empty today; once it is populated this is also the index it needs.
CREATE INDEX IF NOT EXISTS sport_competition_event_competition_idx
  ON sport_competition (event_competition_id);
