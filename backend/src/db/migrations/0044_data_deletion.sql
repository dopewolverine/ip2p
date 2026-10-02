-- Deletion is narrowly authorized, not a general audit-log UPDATE grant.
CREATE TABLE attachment_deletion_queue (
 storage_path text PRIMARY KEY,
 queued_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON attachment_deletion_queue TO ip2p_app;

CREATE FUNCTION purge_due_account(target uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE row_status text; due timestamptz; removable uuid[];
BEGIN
 SELECT status::text, deletion_due_at INTO row_status, due FROM users WHERE id = target FOR UPDATE;
 IF row_status <> 'pending_deletion' OR due IS NULL OR due > now() THEN RETURN false; END IF;
 -- Never revoke the access needed to settle an open escrow.
 IF EXISTS(SELECT 1 FROM contracts WHERE (vendor_id = target OR customer_id = target)
   AND (state NOT IN ('released', 'cancelled') OR (stranded_detected_at IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM broadcasts WHERE contract_id = contracts.id AND status = 'confirmed'))))
 THEN RETURN false; END IF;

 DELETE FROM telegram_links WHERE user_id = target;
 DELETE FROM telegram_link_tokens WHERE user_id = target;
 DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE user_id = target);
 DELETE FROM notifications WHERE user_id = target;
 DELETE FROM notification_preferences WHERE user_id = target;
 DELETE FROM sessions WHERE user_id = target;
 DELETE FROM recovery_codes WHERE user_id = target;
 DELETE FROM recovery_challenges WHERE user_id = target;
 DELETE FROM recovery_grants WHERE user_id = target;
 DELETE FROM password_reset_tokens WHERE user_id = target;
 DELETE FROM wallet_events WHERE user_id = target;
 DELETE FROM transactions WHERE user_id = target;
 DELETE FROM wallets WHERE user_id = target;
 DELETE FROM vendor_stats WHERE user_id = target;
 UPDATE auth_events SET ip_hash = NULL, user_agent = NULL, metadata = NULL WHERE user_id = target;
 UPDATE security_alerts SET user_id = NULL, details = NULL WHERE user_id = target;

 INSERT INTO attachment_deletion_queue(storage_path)
 SELECT storage_path FROM attachments WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = target)
 ON CONFLICT DO NOTHING;
 DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = target);
 DELETE FROM attachments WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = target);
 DELETE FROM tickets WHERE user_id = target;
 -- An anonymized identity row remains for the wallet-blob/audit exceptions.
 UPDATE users SET username = NULL, email = NULL, recovery_address = NULL,
 auth_hash = '', server_salt = ''::bytea, totp_enabled = false, totp_secret_enc = NULL,
 totp_disable_due_at = NULL, totp_last_step = NULL, role = NULL,
 deletion_due_at = NULL, status = 'deleted', updated_at = now() WHERE id = target;

 SELECT array_agg(c.id) INTO removable FROM contracts c
 JOIN users v ON v.id = c.vendor_id JOIN users u ON u.id = c.customer_id
 WHERE v.status = 'deleted' AND u.status = 'deleted' AND c.state IN ('released','cancelled');
 IF removable IS NOT NULL THEN
   INSERT INTO attachment_deletion_queue(storage_path) SELECT storage_path FROM attachments WHERE contract_id = ANY(removable) ON CONFLICT DO NOTHING;
   DELETE FROM messages WHERE contract_id = ANY(removable);
   DELETE FROM attachments WHERE contract_id = ANY(removable);
   DELETE FROM payment_instructions WHERE contract_id = ANY(removable);
   DELETE FROM disputes WHERE contract_id = ANY(removable);
   DELETE FROM security_alerts WHERE contract_id = ANY(removable);
   DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE contract_id = ANY(removable));
   DELETE FROM notifications WHERE contract_id = ANY(removable);
   DELETE FROM broadcasts WHERE contract_id = ANY(removable);
   DELETE FROM contract_transitions WHERE contract_id = ANY(removable);
   DELETE FROM contract_keys WHERE contract_id = ANY(removable);
   DELETE FROM contracts WHERE id = ANY(removable);
 END IF;
 -- Existing counterparties keep their evidence; remove identifying offer text.
 UPDATE offers SET status = 'withdrawn', terms = NULL, paused_reason = 'account_deleted' WHERE vendor_id = target;
 INSERT INTO auth_events(user_id,event_type) VALUES(target,'account_deleted');
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION purge_due_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_due_account(uuid) TO ip2p_app;
