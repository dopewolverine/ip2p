-- The load-bearing grant in this whole file: no UPDATE, no DELETE on
-- messages, for the same reason auth_events has none - a database
-- permission is what makes "no edit, no delete, by anyone" actually true.
GRANT SELECT, INSERT ON messages TO ip2p_app;
REVOKE UPDATE, DELETE ON messages FROM ip2p_app;

GRANT SELECT, INSERT, DELETE ON attachments TO ip2p_app;
GRANT SELECT, INSERT, UPDATE ON disputes TO ip2p_app;
GRANT SELECT, INSERT, UPDATE ON tickets TO ip2p_app;
GRANT SELECT, INSERT ON ticket_messages TO ip2p_app;
