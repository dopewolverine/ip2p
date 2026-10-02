-- Six assets at launch (spec §2.3), matching P1's ASSET_CONFIG exactly.
INSERT INTO assets (symbol, name, chain, slug, decimals, contract_address, active) VALUES
  ('BTC', 'Bitcoin', 'bitcoin', 'bitcoin', 8, NULL, true),
  ('LTC', 'Litecoin', 'litecoin', 'litecoin', 8, NULL, true),
  ('ETH', 'Ethereum', 'ethereum', 'ethereum', 18, NULL, true),
  ('USDT_ERC20', 'Tether (ERC20)', 'ethereum', 'usdt-erc20', 6, '0xdAC17F958D2ee523a2206206994597C13D831ec', true),
  ('USDC_ERC20', 'USD Coin (ERC20)', 'ethereum', 'usdc-erc20', 6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', true),
  ('USDT_TRC20', 'Tether (TRC20)', 'tron', 'usdt-trc20', 6, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', true);

-- A minimal currency seed - real deployments will want the full ISO 4217
-- list; these three exercise the decimal_places edge cases the spec
-- calls out explicitly (JPY 0, USD 2).
INSERT INTO currencies (code, name, symbol, decimal_places, active, slug) VALUES
  ('USD', 'US Dollar', '$', 2, true, 'usd'),
  ('EUR', 'Euro', '€', 2, true, 'eur'),
  ('JPY', 'Japanese Yen', '¥', 0, true, 'jpy')
ON CONFLICT (code) DO NOTHING;
