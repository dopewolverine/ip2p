-- Automatic disputes have a system initiator rather than a fabricated user.
ALTER TABLE disputes ALTER COLUMN opened_by DROP NOT NULL;
INSERT INTO disputes (contract_id, opened_by, reason_code, reason_text)
 SELECT id, NULL, 'timer_expired', 'Recovered dispute record for existing disputed trade'
 FROM contracts WHERE state = 'disputed'
 ON CONFLICT (contract_id) DO NOTHING;

CREATE TABLE payment_instructions (
 id bigserial PRIMARY KEY,
 contract_id uuid NOT NULL REFERENCES contracts(id),
 author_id uuid NOT NULL REFERENCES users(id),
 details text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_instructions_contract ON payment_instructions(contract_id, id);
GRANT SELECT, INSERT ON payment_instructions TO ip2p_app;
GRANT USAGE, SELECT ON SEQUENCE payment_instructions_id_seq TO ip2p_app;
REVOKE UPDATE, DELETE ON payment_instructions FROM ip2p_app;
INSERT INTO payment_instructions(contract_id, author_id, details, created_at)
 SELECT id, CASE WHEN crypto_side = 'vendor' THEN vendor_id ELSE customer_id END,
 payment_details, COALESCE(payment_details_set_at, created_at)
 FROM contracts WHERE payment_details IS NOT NULL;

-- Preserve finalization intent across crashes and defer terminal transitions
-- until the fully signed transaction reaches the required confirmation depth.
ALTER TABLE broadcasts ADD COLUMN final_trigger text NULL,
 ADD COLUMN final_actor_id uuid NULL,
 ADD COLUMN final_actor_type text NULL,
 ADD COLUMN final_reason text NULL,
 ADD COLUMN last_error text NULL,
 ADD COLUMN confirmed_at timestamptz NULL;

CREATE UNIQUE INDEX one_final_settlement_per_contract ON broadcasts(contract_id)
 WHERE purpose IN ('release', 'refund') AND status IN ('signed', 'broadcast', 'confirmed');
