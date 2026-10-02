-- Spec P1 §7.5 - one table for both directions (deposits and
-- withdrawals). The unique constraint is what stops a duplicated webhook
-- or a retried subscription event from creating two rows for one transaction.
CREATE TYPE tx_direction AS ENUM ('in', 'out');
CREATE TYPE tx_status AS ENUM ('pending', 'confirmed', 'failed');

CREATE TABLE transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  wallet_id         uuid NOT NULL REFERENCES wallets(id),
  direction         tx_direction NOT NULL,
  txid              text NOT NULL,
  amount            numeric NOT NULL,
  fee               numeric NULL,
  counterparty      text NULL,
  confirmations     int NOT NULL DEFAULT 0,
  status            tx_status NOT NULL DEFAULT 'pending',
  created_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz NULL,

  UNIQUE (txid, wallet_id, direction)
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_status ON transactions(status) WHERE status = 'pending';
