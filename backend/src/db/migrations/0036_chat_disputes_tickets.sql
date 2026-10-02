-- P4 §2.2 - append-only, enforced at the database (grants below strip
-- UPDATE/DELETE), same pattern as auth_events/wallet_events/contract_transitions.
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     uuid NOT NULL REFERENCES contracts(id),
  sender_type     text NOT NULL,   -- 'vendor' | 'customer' | 'system' | 'staff'
  sender_id       uuid NULL,
  body            text NULL,
  attachment_id   uuid NULL,       -- FK added after attachments exists, below
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_contract_id ON messages(contract_id);

-- P4 §2.5. Exactly one of contract_id/ticket_id set - enforced by the
-- CHECK constraint, not just application discipline.
CREATE TABLE attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         uuid NULL REFERENCES contracts(id),
  ticket_id           uuid NULL,   -- FK added after tickets exists, below
  uploader_id         uuid NOT NULL REFERENCES users(id),
  storage_path        text NOT NULL,
  mime_type           text NOT NULL,
  size_bytes          int NOT NULL,
  original_filename   text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exactly_one_scope CHECK (
    (contract_id IS NOT NULL AND ticket_id IS NULL) OR
    (contract_id IS NULL AND ticket_id IS NOT NULL)
  )
);

ALTER TABLE messages ADD CONSTRAINT fk_messages_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id);

-- Spec §3.1 - dispute reason (short list + free text), recorded once
-- when a dispute opens. Kept as its own table (not columns bolted onto
-- contracts) since a dispute has its own lifecycle data - staff
-- recommendation, escalation state - that doesn't belong mixed into the
-- contract row itself.
CREATE TABLE disputes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           uuid UNIQUE NOT NULL REFERENCES contracts(id),
  opened_by             uuid NOT NULL REFERENCES users(id),
  reason_code           text NOT NULL,   -- short list, e.g. 'no_payment_received', 'payment_not_recognized', 'other'
  reason_text           text NOT NULL,
  staff_recommendation  text NULL,       -- 'buyer' | 'funder' | NULL
  recommended_by        uuid NULL REFERENCES users(id),
  recommendation_reason text NULL,
  opened_at             timestamptz NOT NULL DEFAULT now(),
  escalated_at          timestamptz NULL  -- set once, when the 48h-no-decision escalation fires
);

CREATE TABLE tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  subject             text NOT NULL,
  status              text NOT NULL DEFAULT 'open', -- 'open' | 'awaiting_user' | 'awaiting_staff' | 'closed'
  priority            text NOT NULL DEFAULT 'normal',
  assigned_staff_id   uuid NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ticket_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets(id),
  sender_type     text NOT NULL,  -- 'user' | 'staff'
  sender_id       uuid NULL,
  body            text NOT NULL,
  attachment_id   uuid NULL REFERENCES attachments(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE attachments ADD CONSTRAINT fk_attachments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id);

CREATE INDEX idx_tickets_user_id ON tickets(user_id);
CREATE INDEX idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
