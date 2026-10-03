-- Application tables must exist first. Neon Auth stays the managed provider.
-- NO identities, session tokens, passwords, emails, IPs or OTP values are stored here.
CREATE TABLE auth_throttle (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  window_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_throttle_expiry_idx ON auth_throttle(expires_at);
CREATE TABLE auth_otp_challenge (
  key TEXT PRIMARY KEY NOT NULL,
  generation TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 3),
  ready INTEGER NOT NULL CHECK (ready IN (0, 1)),
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_otp_challenge_expiry_idx ON auth_otp_challenge(expires_at);
