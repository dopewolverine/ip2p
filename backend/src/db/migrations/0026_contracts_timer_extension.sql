-- Spec §7.1 downtime handling - kept separate from funded_at/paid_at
-- (which record when those events actually happened) so extending a
-- window for an outage never corrupts the historical timestamps.
ALTER TABLE contracts ADD COLUMN timer_extension_seconds int NOT NULL DEFAULT 0;
