// Spec P3 §3.2 - margin offers need a live reference price. Primary:
// CoinGecko. Fallback: Kraken public API. Cached 60s. "If both feeds are
// down: margin offers pause, fixed offers are unaffected... never serve
// a stale margin price."
//
// Live CoinGecko and Kraken response validation remains required before
// production pricing is enabled.

interface PriceCacheEntry {
  price: number;
  expiresAt: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, PriceCacheEntry>();

// Maps our asset symbols to each provider's own identifiers.
const COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin', LTC: 'litecoin', ETH: 'ethereum',
  USDT_ERC20: 'tether', USDC_ERC20: 'usd-coin', USDT_TRC20: 'tether',
};
const KRAKEN_PAIR: Record<string, string> = {
  BTC: 'XBTUSD', LTC: 'LTCUSD', ETH: 'ETHUSD',
  // Kraken doesn't quote stablecoins against themselves usefully - for
  // USDT/USDC, a margin offer priced off "USDT in USD" is close enough
  // to 1:1 that this mapping intentionally has no Kraken fallback entry;
  // those two assets rely on CoinGecko alone. Worth a second look once
  // this is tested against real data.
};

async function fetchFromCoinGecko(symbol: string): Promise<number | null> {
  const id = COINGECKO_ID[symbol];
  if (!id) return null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data?.[id]?.usd ?? null;
  } catch {
    return null;
  }
}

async function fetchFromKraken(symbol: string): Promise<number | null> {
  const pair = KRAKEN_PAIR[symbol];
  if (!pair) return null;
  try {
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const key = Object.keys(data?.result ?? {})[0];
    const result = key ? data.result[key] : undefined;
    const lastTrade = result?.c?.[0];
    return lastTrade ? parseFloat(lastTrade) : null;
  } catch {
    return null;
  }
}

// Returns null when both feeds are down - callers MUST treat that as
// "pause the offer," never fall back to a cached-but-expired value.
export async function getReferencePriceUsd(symbol: string): Promise<number | null> {
  const cached = cache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.price;

  let price = await fetchFromCoinGecko(symbol);
  if (price === null) price = await fetchFromKraken(symbol);
  if (price === null) return null;

  cache.set(symbol, { price, expiresAt: Date.now() + TTL_MS });
  return price;
}
