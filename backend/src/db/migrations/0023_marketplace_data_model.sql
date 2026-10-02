-- Spec P3 §2 - reference data. currencies already exists (P2 §3);
-- extended here, never recreated.
ALTER TABLE currencies ADD COLUMN slug text UNIQUE;

CREATE TABLE countries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_code              text UNIQUE NOT NULL,
  name                  text NOT NULL,
  slug                  text UNIQUE NOT NULL,
  default_currency_id   uuid REFERENCES currencies(id),
  active                bool NOT NULL DEFAULT true
);

CREATE TABLE assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol            text UNIQUE NOT NULL,   -- 'BTC','LTC','ETH','USDT_ERC20','USDC_ERC20','USDT_TRC20'
  name              text NOT NULL,
  chain             text NOT NULL,
  slug              text UNIQUE NOT NULL,
  decimals          int NOT NULL,
  contract_address  text NULL,              -- ERC20/TRC20 only
  active            bool NOT NULL DEFAULT true
);

CREATE TABLE payment_methods (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  slug                    text UNIQUE NOT NULL,
  category                text NOT NULL,
  risk_tier               int NOT NULL CHECK (risk_tier BETWEEN 1 AND 4),
  countries               text[] NOT NULL DEFAULT '{}',   -- ISO codes
  currencies              text[] NOT NULL DEFAULT '{}',   -- currency codes
  reversal_window_days    int NOT NULL DEFAULT 0,
  min_vendor_reputation   numeric NULL,      -- P5 doesn't exist yet; nullable until it does
  max_trade_amount        numeric NULL,
  requires_evidence       bool NOT NULL DEFAULT false,
  active                  bool NOT NULL DEFAULT true
  -- Gift cards are excluded entirely from this table by convention -
  -- not a disabled row, not a tier-5 row. Absent.
);

CREATE TYPE offer_side AS ENUM ('buy', 'sell');
CREATE TYPE offer_price_type AS ENUM ('fixed', 'margin');
CREATE TYPE offer_status AS ENUM ('active', 'paused', 'withdrawn');

CREATE TABLE offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id             uuid NOT NULL REFERENCES users(id),
  side                  offer_side NOT NULL,
  asset_id              uuid NOT NULL REFERENCES assets(id),
  country_id            uuid NOT NULL REFERENCES countries(id),
  fiat_currency_id      uuid NOT NULL REFERENCES currencies(id),
  payment_method_id     uuid NOT NULL REFERENCES payment_methods(id),
  price_type            offer_price_type NOT NULL,
  price                 numeric(24,8) NULL,     -- fixed only
  margin_percent        numeric(6,3) NULL,      -- margin only
  min_amount            numeric(24,8) NOT NULL, -- fiat_currency
  max_amount            numeric(24,8) NOT NULL,
  total_available       numeric(36,18) NOT NULL, -- crypto ceiling across open trades
  terms                 text NULL,
  payment_window_hours  int NOT NULL,
  status                offer_status NOT NULL DEFAULT 'active',
  paused_reason         text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Spec §3.1 - the four discovery columns, mandatory, indexed, never
-- nullable. The page generator (§6.2) is a query against exactly this index.
CREATE INDEX idx_offers_discovery
  ON offers (side, asset_id, country_id, payment_method_id)
  WHERE status = 'active';

CREATE INDEX idx_offers_vendor_id ON offers(vendor_id);
