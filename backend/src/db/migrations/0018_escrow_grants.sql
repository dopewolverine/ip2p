GRANT SELECT, INSERT, UPDATE, DELETE ON
  currencies,
  contracts,
  contract_keys,
  broadcasts
TO ip2p_app;

-- platform_keys holds only PUBLIC key material (xpubs), but it's still
-- the record of which extended keys are authoritative for escrow
-- derivation - the app can read it, but changing which keys are active
-- is an operational action, not something request-handling code should
-- ever do. No UPDATE/DELETE for the app role; only INSERT for onboarding
-- a newly-active key.
GRANT SELECT, INSERT ON platform_keys TO ip2p_app;

-- Same append-only reasoning as auth_events/wallet_events - a transition
-- history that could be edited or deleted isn't an audit trail.
GRANT SELECT, INSERT ON contract_transitions TO ip2p_app;
REVOKE UPDATE, DELETE ON contract_transitions FROM ip2p_app;
