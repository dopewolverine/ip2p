-- Backs P0 §7A - the nonce isn't secret (the client signs it; the
-- signature is what matters), so it's stored raw. Single-use and expiry
-- are what matter, both enforced here.
CREATE TABLE recovery_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  nonce         bytea NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recovery_challenges_user_id ON recovery_challenges(user_id);
