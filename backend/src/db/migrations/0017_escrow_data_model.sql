-- P2 §3 - the escrow data model. currencies/platform_keys deliberately
-- defined here (not P3) per spec §3: P2 needs currencies for fiat amounts
-- before any marketplace UI exists, and platform_keys before any escrow
-- address can be derived.

CREATE TABLE currencies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            citext UNIQUE NOT NULL,  -- ISO 4217
  name            text NOT NULL,
  symbol          text NOT NULL,
  decimal_places  int NOT NULL,            -- load-bearing: JPY 0, most 2, some 3
  active          bool NOT NULL DEFAULT true
);

-- Public key material only - see the hard constraint below. The
-- corresponding private keys exist only on the Owner's Ledger devices,
-- never in this table, never in config, never in the repo.
CREATE TABLE platform_keys (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain             text NOT NULL,   -- 'bitcoin' | 'litecoin' only — EVM/Tron arbitrator is a single address (§5.3), not an xpub
  xpub              text NOT NULL,
  derivation_base   text NOT NULL,   -- e.g. m/45'/0'
  active            bool NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference                   text UNIQUE NOT NULL,  -- human-facing, e.g. "TR-8F3K2M"
  escrow_version              int NOT NULL,           -- logic version at creation, never changed after
  offer_id                    uuid NULL,               -- P3 populates this
  vendor_id                   uuid NOT NULL REFERENCES users(id),
  customer_id                 uuid NOT NULL REFERENCES users(id),
  crypto_side                 text NOT NULL,           -- 'vendor' | 'customer'
  asset                       text NOT NULL,           -- BTC | LTC | ETH | USDT_ERC20 | USDC_ERC20 | USDT_TRC20
  chain                       text NOT NULL,           -- bitcoin | litecoin | ethereum | tron
  amount                      numeric(36,18) NOT NULL, -- crypto, excluding fee
  fee_amount                  numeric(36,18) NOT NULL, -- snapshotted at creation
  fee_rate_bps                int NOT NULL,             -- snapshotted at creation
  fiat_currency_id            uuid NOT NULL REFERENCES currencies(id),
  fiat_amount                 numeric(24,8) NOT NULL,
  price_snapshot               numeric(24,8) NOT NULL,
  payment_window_hours        int NOT NULL,             -- from the offer, adjustable at acceptance
  contract_index               bigint NOT NULL,          -- the `n` in the derivation path
  escrow_address               text NULL,                -- populated at 'accepted'
  redeem_script                text NULL,                -- BTC/LTC only, hex
  contract_address              text NULL,                -- EVM/Tron only
  onchain_trade_id              text NULL,                -- EVM/Tron only, id inside the contract
  funding_txid                  text NULL,
  release_txid                  text NULL,
  state                         text NOT NULL,
  resolution                    text NULL,                -- 'released_to_buyer' | 'refunded_to_funder'
  resolved_by                   uuid NULL REFERENCES users(id),
  resolution_reason             text NULL,
  cancelled_reason               text NULL,
  customer_last_activity_at      timestamptz NULL,
  vendor_last_activity_at        timestamptz NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  accepted_at                    timestamptz NULL,
  funded_at                      timestamptz NULL,
  paid_at                        timestamptz NULL,
  closed_at                      timestamptz NULL
);

CREATE INDEX idx_contracts_vendor_id ON contracts(vendor_id);
CREATE INDEX idx_contracts_customer_id ON contracts(customer_id);
CREATE INDEX idx_contracts_state ON contracts(state);

CREATE TABLE contract_keys (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       uuid NOT NULL REFERENCES contracts(id),
  party             text NOT NULL,   -- 'vendor' | 'customer' | 'platform'
  public_key        text NOT NULL,   -- hex. NEVER a private key.
  derivation_path   text NOT NULL,
  UNIQUE (contract_id, party)
);

CREATE TABLE contract_transitions (
  id                bigserial PRIMARY KEY,
  contract_id       uuid NOT NULL REFERENCES contracts(id),
  from_state        text NULL,
  to_state          text NOT NULL,
  actor_type        text NOT NULL,   -- 'user' | 'system' | 'admin'
  actor_id          uuid NULL,
  reason            text NULL,
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- A retried request can't double-transition a contract - this unique
  -- constraint is what makes that structurally true, not just unlikely.
  UNIQUE (idempotency_key)
);

CREATE INDEX idx_contract_transitions_contract_id ON contract_transitions(contract_id);

CREATE TABLE broadcasts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       uuid NOT NULL REFERENCES contracts(id),
  purpose           text NOT NULL,   -- 'funding' | 'release' | 'refund'
  txid              text NULL,
  raw_tx            text NOT NULL,
  status            text NOT NULL,   -- 'pending' | 'broadcast' | 'confirmed' | 'failed'
  attempts          int NOT NULL DEFAULT 0,
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- A contract can only ever have one release and one refund - this is
  -- the constraint that makes double-payment structurally impossible.
  UNIQUE (contract_id, purpose)
);
