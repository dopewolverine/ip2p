interface RatesCacheEntry { rates: Record<string, number>; expiresAt: number }
const TTL_MS = 60_000;
let cache: RatesCacheEntry | null = null;
let pending: Promise<Record<string, number> | null> | null = null;
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'];

// ECB reference rates are daily; a fresh HTTP response with an old date
// is not a fresh rate. Allow weekends/holidays, but no older than 7 days.
export async function getUsdRates(): Promise<Record<string, number> | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.rates;
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json() as { base?: string; date?: string; rates?: Record<string, unknown> };
      const date = Date.parse(String(data.date));
      if (data.base !== 'USD' || !Number.isFinite(date) || date > Date.now() + 86400000 || Date.now() - date > 7 * 86400000) return null;
      const rates: Record<string, number> = { USD: 1 };
      for (const [code, rate] of Object.entries(data.rates ?? {})) {
        if (/^[A-Z]{3}$/.test(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) rates[code] = rate;
      }
      cache = { rates, expiresAt: Date.now() + TTL_MS };
      return rates;
    } catch { return null; }
  })();
  try { return await pending; } finally { pending = null; }
}
