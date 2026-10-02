-- P5 §8.1 - computed nightly, never per page load. Keyed by user_id
-- (any user, not just offer-posting vendors - anyone can be the
-- reputation-bearing side of a contract, whether they're contracts.vendor_id
-- or contracts.customer_id on any given trade).
CREATE TABLE vendor_stats (
  user_id                 uuid PRIMARY KEY REFERENCES users(id),
  total_trades            int NOT NULL DEFAULT 0,
  trades_30d              int NOT NULL DEFAULT 0,
  completion_rate_30d     numeric(5,4) NULL,   -- NULL when there's no denominator yet (no trades or cancellations in window)
  avg_release_seconds     int NULL,             -- NULL if never the crypto side of a released trade
  avg_pay_seconds         int NULL,             -- NULL if never the fiat side of a released trade
  distinct_counterparties int NOT NULL DEFAULT 0,
  badge                   text NOT NULL DEFAULT 'new',  -- 'new' | 'established' | 'trusted'
  computed_at             timestamptz NOT NULL DEFAULT now()
);
