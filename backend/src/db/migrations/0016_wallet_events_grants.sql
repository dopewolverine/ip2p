-- Same append-only enforcement as auth_events (spec P0 §4 pattern,
-- applied here to P1's event log for the same reason).
GRANT SELECT, INSERT ON wallet_events TO ip2p_app;
REVOKE UPDATE, DELETE ON wallet_events FROM ip2p_app;
