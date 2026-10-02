GRANT SELECT, UPDATE ON currencies TO ip2p_app; -- slug column now writable (P2's grant only covered the original columns implicitly via table-level GRANT already, but re-stated for clarity)
GRANT SELECT ON countries, assets, payment_methods TO ip2p_app;
GRANT SELECT, INSERT, UPDATE ON offers TO ip2p_app;
