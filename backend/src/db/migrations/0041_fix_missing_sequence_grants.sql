-- Bug fix: GRANT INSERT on a table with a bigserial column does NOT
-- automatically grant USAGE on the underlying sequence in Postgres -
-- every append-only table using bigserial needed this and didn't have
-- it, which silently broke every INSERT into these tables.
GRANT USAGE, SELECT ON SEQUENCE auth_events_id_seq TO ip2p_app;
GRANT USAGE, SELECT ON SEQUENCE wallet_events_id_seq TO ip2p_app;
GRANT USAGE, SELECT ON SEQUENCE contract_transitions_id_seq TO ip2p_app;
GRANT USAGE, SELECT ON SEQUENCE timer_outage_adjustments_id_seq TO ip2p_app;
