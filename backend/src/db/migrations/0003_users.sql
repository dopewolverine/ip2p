-- username is nullable: spec §12 releases it on account deletion so a new
-- registration can reuse it. No pin_hash/pin_salt (spec §3.1.1 - PIN
-- removed; sensitive actions use inline password re-entry instead). No
-- client-side KDF salt here - it lives per-row on wallet_blobs (§4.1),
-- since a single column on users would make every archived blob
-- permanently undecryptable after a password reset.
CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username                citext UNIQUE NULL,
  email                   citext UNIQUE NULL,
  auth_hash               text NOT NULL,
  server_salt             bytea NOT NULL,
  recovery_address        text NULL,
  reputation_held_until   timestamptz NULL,
  totp_secret_enc         bytea NULL,
  totp_enabled            bool NOT NULL DEFAULT false,
  totp_disable_due_at     timestamptz NULL,
  status                  user_status NOT NULL DEFAULT 'pending_seed_confirmation',
  deletion_due_at         timestamptz NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
