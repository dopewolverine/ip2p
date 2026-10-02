-- P2 §5.3 - "record the deployed address, the deployment transaction,
-- the compiler version, and the exact source used." One row per chain,
-- inserted once by hand after the real contract has been read, verified,
-- and deployed - never written by request-handling code.
CREATE TABLE contract_deployments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain               text NOT NULL,   -- 'ethereum' | 'tron'
  contract_address    text NOT NULL,
  deployment_txid     text NOT NULL,
  compiler_version    text NOT NULL,
  source_hash         text NOT NULL,   -- hash of the exact verified source used
  arbitrator_address  text NOT NULL,   -- derived from the Owner's hardware wallet
  fee_recipient       text NOT NULL,
  fee_rate_bps        int NOT NULL,
  active              bool NOT NULL DEFAULT true,
  deployed_at         timestamptz NOT NULL DEFAULT now()
);

-- Only one ACTIVE deployment per chain at a time - old/retired
-- deployments stay in the table as history, not blocked by this.
CREATE UNIQUE INDEX uq_contract_deployments_active_per_chain
  ON contract_deployments(chain) WHERE active = true;
