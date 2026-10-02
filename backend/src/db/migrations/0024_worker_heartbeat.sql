-- Backs the downtime-extension requirement in P2 §7.1: "downtime pauses
-- timers. On restart, extend every active window by the outage duration
-- and email both parties on affected trades. Log the outage window so
-- the adjustment is auditable in a later dispute." A single row,
-- updated every tick - the gap between two consecutive updates IS the
-- outage duration on restart.
CREATE TABLE worker_heartbeat (
  worker_name       text PRIMARY KEY,
  last_tick_at      timestamptz NOT NULL
);

-- Every recorded downtime adjustment, kept permanently - "auditable in a
-- later dispute" means this can't be pruned or overwritten.
CREATE TABLE timer_outage_adjustments (
  id                bigserial PRIMARY KEY,
  worker_name       text NOT NULL,
  outage_started_at timestamptz NOT NULL,
  outage_detected_at timestamptz NOT NULL,
  outage_seconds    int NOT NULL,
  contracts_affected int NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
