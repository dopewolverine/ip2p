CREATE TABLE recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  code_hash   text NOT NULL,
  used_at     timestamptz NULL
);

CREATE INDEX idx_recovery_codes_user_id ON recovery_codes(user_id);
