-- Fixes from the September 2026 review. See FIXES.md for the reasoning.

-- 1. End every existing session. Until the update, every session token
--    was written to the server log, so any token issued before this
--    migration must be treated as exposed.
UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;

-- 2. Seed-recovery grants: setting a new password after seed recovery
--    needs this single-use, 15-minute grant (previously any session could).
CREATE TABLE recovery_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recovery_grants_user_id ON recovery_grants(user_id);
GRANT SELECT, INSERT, UPDATE ON recovery_grants TO ip2p_app;

-- 3. TOTP replay protection: the last time-step accepted per account.
ALTER TABLE users ADD COLUMN totp_last_step bigint NULL;

-- 4. Contract amounts hold integers in base units (P2 §4A.7). numeric(36,18)
--    came back as "5000000.000000000000000000", which crashed every BigInt
--    conversion, and could not hold more than ~1 ETH in wei.
ALTER TABLE contracts ALTER COLUMN amount TYPE numeric(78,0) USING round(amount)::numeric(78,0);
ALTER TABLE contracts ALTER COLUMN fee_amount TYPE numeric(78,0) USING round(fee_amount)::numeric(78,0);

-- 5. Escrow: network-fee reserve (snapshotted at address generation),
--    the exact funding outpoint, stranded-funds flag, payment details.
ALTER TABLE contracts
  ADD COLUMN network_reserve        numeric(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN funding_vout           int NULL,
  ADD COLUMN stranded_detected_at   timestamptz NULL,
  ADD COLUMN payment_details        text NULL,
  ADD COLUMN payment_details_set_at timestamptz NULL;

-- 6. Each party's payout address, recorded with its escrow key (P2 §4A.1
--    checks the recipient against "the counterparty address from the contract").
ALTER TABLE contract_keys ADD COLUMN payout_address text NULL;

-- 7. The single server-built PSBT per contract+purpose (P2 §4.3).
--    Statuses: proposed | partially_signed | signed | broadcast | confirmed | failed
ALTER TABLE broadcasts ALTER COLUMN raw_tx DROP NOT NULL;
ALTER TABLE broadcasts
  ADD COLUMN psbt         text NULL,
  ADD COLUMN first_signer text NULL,
  ADD COLUMN fee_rate     numeric(20,0) NULL,
  ADD COLUMN network_fee  numeric(78,0) NULL,
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now();

-- 8. Exactly one active platform key per chain.
CREATE UNIQUE INDEX uq_platform_keys_one_active_per_chain ON platform_keys(chain) WHERE active = true;

-- 9. Client verification failures (P2 §4A.1 "raises a security alert").
CREATE TABLE security_alerts (
  id           bigserial PRIMARY KEY,
  user_id      uuid NULL REFERENCES users(id),
  contract_id  uuid NULL REFERENCES contracts(id),
  check_name   text NOT NULL,
  details      jsonb NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON security_alerts TO ip2p_app;
REVOKE UPDATE, DELETE ON security_alerts FROM ip2p_app;
GRANT USAGE, SELECT ON SEQUENCE security_alerts_id_seq TO ip2p_app;

-- 10. Sequencing: trading only where escrow exists (BTC, LTC). EVM/Tron
--     wait for the P2 prerequisite (LocalCoinSwap contract read + permission).
UPDATE assets SET active = false WHERE chain IN ('ethereum', 'tron');
UPDATE offers SET status = 'paused', paused_reason = 'asset_not_tradeable_yet', updated_at = now()
 WHERE status = 'active' AND asset_id IN (SELECT id FROM assets WHERE chain IN ('ethereum', 'tron'));

-- 11. The USDT-ERC20 contract address in the 0028 seed was missing its last character.
UPDATE assets SET contract_address = '0xdAC17F958D2ee523a2206206994597C13D831ec7' WHERE symbol = 'USDT_ERC20';
