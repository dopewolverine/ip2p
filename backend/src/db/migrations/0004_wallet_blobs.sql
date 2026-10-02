CREATE TABLE wallet_blobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  blob          bytea NOT NULL,
  iv            bytea NOT NULL,
  salt          bytea NOT NULL,  -- 16 bytes, client-side KDF salt for THIS blob (spec §4.1)
  kdf_params    jsonb NOT NULL,
  status        wallet_blob_status NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz NULL
);

CREATE INDEX idx_wallet_blobs_user_id ON wallet_blobs(user_id);

-- Exactly one 'current' blob per user (acceptance criterion 18).
CREATE UNIQUE INDEX uq_wallet_blobs_one_current_per_user
  ON wallet_blobs(user_id)
  WHERE status = 'current';
