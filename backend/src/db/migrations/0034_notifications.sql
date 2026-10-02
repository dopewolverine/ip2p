-- P4 §4.3 - the outbox pattern. Written in the SAME transaction as
-- whatever caused it (spec: "a failed send silently loses the event").
-- A worker reads unprocessed notification_deliveries rows separately.
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  type          text NOT NULL,
  priority      text NOT NULL,   -- 'critical' | 'normal' | 'low' | 'security'
  contract_id   uuid NULL REFERENCES contracts(id),
  -- For contract-scoped events, contract_id IS the natural dedup key
  -- (a contract only passes through each transition once) and this
  -- stays NULL. For events with no contract - mainly the security
  -- category (password changed, 2FA changed, ...), which can
  -- legitimately recur many times over an account's life - this
  -- carries a fresh value per real occurrence (a timestamp or random
  -- token), so the unique constraint below only catches genuine
  -- retries of the SAME event, never suppresses a second real one.
  dedupe_key    text NOT NULL DEFAULT '',
  payload       jsonb NULL,
  read_at       timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- "A retried event cannot fire the same alert twice." Works for both
  -- cases above: contract-scoped calls leave dedupe_key at its default
  -- (empty string, itself a valid dedup value - one per contract+type
  -- forever, which is correct there), non-contract calls set a real one.
  UNIQUE (user_id, type, contract_id, dedupe_key)
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);

CREATE TABLE notification_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id   uuid NOT NULL REFERENCES notifications(id),
  channel           text NOT NULL,   -- 'web' | 'email' | 'telegram'
  status            text NOT NULL DEFAULT 'pending',  -- 'pending' | 'delivered' | 'failed'
  attempts          int NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz NULL,
  delivered_at      timestamptz NULL
);

CREATE INDEX idx_notification_deliveries_pending ON notification_deliveries(status) WHERE status = 'pending';

-- Spec §4.2 - every category is user-mutable except security, which
-- cannot be muted (enforced in code, not by omitting a row here - the
-- table still records a row for consistency, but emitNotification.ts
-- never checks it for security-priority events).
CREATE TABLE notification_preferences (
  user_id       uuid PRIMARY KEY REFERENCES users(id),
  critical_web  bool NOT NULL DEFAULT true,
  critical_telegram bool NOT NULL DEFAULT true,
  critical_email bool NOT NULL DEFAULT true,
  normal_web    bool NOT NULL DEFAULT true,
  normal_telegram bool NOT NULL DEFAULT true,
  low_web       bool NOT NULL DEFAULT true
);

-- Spec §4.4 - link flow, delivery only, never authentication.
CREATE TABLE telegram_links (
  user_id       uuid PRIMARY KEY REFERENCES users(id),
  chat_id       text UNIQUE NOT NULL,
  linked_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telegram_link_tokens (
  token         text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz NULL
);
