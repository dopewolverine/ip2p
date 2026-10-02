-- Spec P1 §10 - a parallel, append-only log for wallet actions, same
-- shape and purpose as P0's auth_events but a separate table since these
-- are a different vocabulary of events (never mixed with auth events).
CREATE TABLE wallet_events (
  id            bigserial PRIMARY KEY,
  user_id       uuid NULL REFERENCES users(id),
  event_type    text NOT NULL,
  asset         text NULL,
  metadata      jsonb NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_events_user_id ON wallet_events(user_id);
CREATE INDEX idx_wallet_events_event_type ON wallet_events(event_type);
