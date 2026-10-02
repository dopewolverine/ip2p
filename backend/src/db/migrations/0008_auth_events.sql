CREATE TABLE auth_events (
  id            bigserial PRIMARY KEY,
  user_id       uuid NULL REFERENCES users(id),
  event_type    text NOT NULL,
  ip_hash       text NULL,
  user_agent    text NULL,
  metadata      jsonb NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_events_user_id ON auth_events(user_id);
CREATE INDEX idx_auth_events_event_type ON auth_events(event_type);
