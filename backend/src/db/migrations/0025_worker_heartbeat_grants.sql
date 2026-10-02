GRANT SELECT, INSERT, UPDATE ON worker_heartbeat TO ip2p_app;
GRANT SELECT, INSERT ON timer_outage_adjustments TO ip2p_app;
REVOKE UPDATE, DELETE ON timer_outage_adjustments FROM ip2p_app;
