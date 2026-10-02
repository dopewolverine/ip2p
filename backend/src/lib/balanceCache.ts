// Spec P1 §5.1 - cache a fetched balance for 60 seconds; manual refresh
// bypasses it. In-memory, single-instance - same caveat as the rate
// limiter: move to Redis if this ever runs on more than one backend process.

interface CacheEntry {
  balance: { confirmed: string; unconfirmed: string };
  expiresAt: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function key(userId: string, asset: string): string {
  return `${userId}:${asset}`;
}

export function getCachedBalance(userId: string, asset: string) {
  const entry = cache.get(key(userId, asset));
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.balance;
}

export function setCachedBalance(userId: string, asset: string, balance: { confirmed: string; unconfirmed: string }) {
  cache.set(key(userId, asset), { balance, expiresAt: Date.now() + TTL_MS });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(k);
  }
}, 60_000).unref();
