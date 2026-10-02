-- Spec P1 §4.3. blob_id is what makes archived wallets work: a password
-- reset or seed recovery creates a new wallet_blobs row, and every wallet
-- row tied to the OLD blob_id flips to 'archived' while new rows for the
-- new blob_id become 'active' - same pattern as wallet_blobs itself.
--
-- Separate enum from wallet_blob_status: wallets use active/archived,
-- wallet_blobs use current/archived - different vocabularies for
-- different things, even though both mark the "old" side the same word.
CREATE TYPE wallet_status AS ENUM ('active', 'archived');

CREATE TABLE wallets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  asset             text NOT NULL,   -- 'BTC','LTC','ETH','USDT_ERC20','USDC_ERC20','USDT_TRC20'
  chain             text NOT NULL,   -- 'bitcoin','litecoin','ethereum','tron'
  address           text NOT NULL,
  derivation_path   text NOT NULL,
  blob_id           uuid NOT NULL REFERENCES wallet_blobs(id),
  status            wallet_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, asset, blob_id)
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_address ON wallets(address);
