-- A minimal seed so offer creation is actually exercisable - real
-- deployments will want the full country list and a properly
-- risk-tiered payment method catalog (core plan §11.3); this covers
-- enough to test the flow end to end.
INSERT INTO countries (iso_code, name, slug, default_currency_id, active)
SELECT 'US', 'United States', 'united-states', id, true FROM currencies WHERE code = 'USD'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO countries (iso_code, name, slug, default_currency_id, active)
SELECT 'DE', 'Germany', 'germany', id, true FROM currencies WHERE code = 'EUR'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO countries (iso_code, name, slug, default_currency_id, active)
SELECT 'JP', 'Japan', 'japan', id, true FROM currencies WHERE code = 'JPY'
ON CONFLICT (slug) DO NOTHING;

-- Tier 1 (bank transfer - low reversal risk) and tier 3 (a faster,
-- higher-reversal-risk rail) as the two most common real-world cases.
-- Gift cards deliberately absent (spec §2.4 - not tier 5, not disabled, absent).
INSERT INTO payment_methods (name, slug, category, risk_tier, countries, currencies, reversal_window_days, requires_evidence, active)
VALUES
  ('Bank Transfer', 'bank-transfer', 'bank', 1, '{US,DE,JP}', '{USD,EUR,JPY}', 0, true, true),
  ('Instant App Transfer', 'instant-app-transfer', 'app', 3, '{US,DE}', '{USD,EUR}', 180, true, true)
ON CONFLICT (slug) DO NOTHING;
