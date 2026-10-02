CREATE TYPE user_status AS ENUM (
  'pending_seed_confirmation',
  'active',
  'disabled',
  'pending_deletion',
  'deleted'
);

CREATE TYPE wallet_blob_status AS ENUM ('current', 'archived');
