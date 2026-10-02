import { Request, Response, NextFunction } from 'express';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// In-memory, single-instance limiter - matches a single-VPS deployment.
// If iP2P ever runs multiple backend instances, swap the Map for Redis.
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyFn: (req: Request) => string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts.keyFn(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    if (bucket.count >= opts.max) {
      return res.status(429).json({ error: 'rate_limited' });
    }

    bucket.count += 1;
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();
