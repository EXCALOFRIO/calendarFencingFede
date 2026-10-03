-- Apply only to the application D1, after the verified application import.
-- A self-declared name/license requests review; it never grants ownership.
CREATE TABLE athlete_link_request (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 5 AND 140),
  claimed_name TEXT NOT NULL CHECK (length(claimed_name) <= 160),
  state TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (state IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  requested_at INTEGER NOT NULL CHECK (typeof(requested_at) = 'integer'),
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR typeof(reviewed_at) = 'integer'),
  reviewed_by_profile_id TEXT REFERENCES user_profile(id) ON DELETE RESTRICT,
  athlete_id TEXT REFERENCES athlete(id) ON DELETE SET NULL,
  evidence TEXT,
  CHECK (
    (state = 'PENDIENTE' AND reviewed_at IS NULL
      AND reviewed_by_profile_id IS NULL AND athlete_id IS NULL AND evidence IS NULL)
    OR
    (state <> 'PENDIENTE' AND reviewed_at IS NOT NULL
      AND reviewed_by_profile_id IS NOT NULL AND evidence IS NOT NULL
      AND length(evidence) BETWEEN 20 AND 1000)
  )
);
CREATE UNIQUE INDEX athlete_link_request_pending_profile_idx
  ON athlete_link_request(profile_id) WHERE state = 'PENDIENTE';
CREATE INDEX athlete_link_request_review_idx ON athlete_link_request(state, requested_at);
CREATE INDEX athlete_link_request_rate_idx ON athlete_link_request(profile_id, requested_at);
