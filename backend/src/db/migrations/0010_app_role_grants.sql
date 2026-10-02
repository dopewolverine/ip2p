-- Assumes the ip2p_app role already exists (created manually, see README -
-- its password should never live in a versioned migration file).

GRANT CONNECT ON DATABASE ip2p TO ip2p_app;
GRANT USAGE ON SCHEMA public TO ip2p_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users,
  wallet_blobs,
  sessions,
  recovery_codes,
  password_reset_tokens,
  recovery_challenges
TO ip2p_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ip2p_app;

-- auth_events is append-only, enforced here rather than by convention
-- (acceptance criterion 17): the app role can insert and read, but the
-- database itself refuses UPDATE or DELETE regardless of what application
-- code tries to do.
GRANT SELECT, INSERT ON auth_events TO ip2p_app;
REVOKE UPDATE, DELETE ON auth_events FROM ip2p_app;
