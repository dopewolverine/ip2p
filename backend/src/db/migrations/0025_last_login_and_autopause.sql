-- Spec P3 §3.4 - "offers auto-pause when the vendor hasn't logged in
-- for 48 hours." Needs a last-login timestamp; auth_events has
-- login_success rows but scanning them for every offer on every sweep
-- doesn't scale the way one indexed column does.
ALTER TABLE users ADD COLUMN last_login_at timestamptz NULL;
