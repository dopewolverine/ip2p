import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireSession } from '../middleware/auth';
import { hasAdminRole } from '../lib/roles';
import { rateLimit } from '../middleware/rateLimit';
import { resolveOfferPrice } from '../marketplace/pricing';
import { getSerializedReputationBatch } from '../reputation/serializer';
import { TIER_4_MIN_REPUTATION_TRADES, TIER_4_NEW_ACCOUNT_MIN_AGE_DAYS } from '../reputation/config';

export const offersRouter = Router();

// ---- POST /offers ----
const createOfferSchema = z.object({
  side: z.enum(['buy', 'sell']),
  asset_slug: z.string().min(1),
  country_slug: z.string().min(1),
  fiat_currency_code: z.string().length(3),
  payment_method_slug: z.string().min(1),
  price_type: z.enum(['fixed', 'margin']),
  price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  margin_percent: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
  min_amount: z.string().regex(/^\d+(\.\d+)?$/),
  max_amount: z.string().regex(/^\d+(\.\d+)?$/),
  total_available: z.string().regex(/^\d+(\.\d+)?$/),
  terms: z.string().optional(),
  payment_window_hours: z.number().int().positive(),
}).refine(
  (d) => (d.price_type === 'fixed' ? !!d.price && !d.margin_percent : !!d.margin_percent && !d.price),
  { message: 'fixed offers need price only; margin offers need margin_percent only' }
);

offersRouter.post(
  '/offers',
  requireSession,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyFn: (req) => `offers_create:${req.user!.id}` }),
  async (req, res) => {
    if (req.user!.status === 'pending_deletion') return res.status(409).json({ error: 'account_pending_deletion' });
    const parsed = createOfferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input', message: parsed.error.issues[0]?.message });
    const d = parsed.data;

    // DEV-BRIEF §4A - staff/admin accounts don't trade.
    if (await hasAdminRole(req.user!.id)) return res.status(403).json({ error: 'staff_accounts_cannot_trade' });

    const minAmount = parseFloat(d.min_amount);
    const maxAmount = parseFloat(d.max_amount);

    if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount <= 0 || maxAmount <= 0) {
      return res.status(400).json({ error: 'invalid_amount_values' });
    }

    if (minAmount > maxAmount) {
      return res.status(400).json({ error: 'min_exceeds_max' });
    }

    // Offers only on chains with working escrow (BTC, LTC).
    const { rows: assetRows } = await pool.query(
      `SELECT id FROM assets WHERE slug = $1 AND active = true AND chain IN ('bitcoin', 'litecoin')`, [d.asset_slug]
    );
    const { rows: countryRows } = await pool.query('SELECT id FROM countries WHERE slug = $1 AND active = true', [d.country_slug]);
    const { rows: currencyRows } = await pool.query('SELECT id FROM currencies WHERE code = $1 AND active = true', [d.fiat_currency_code.toUpperCase()]);
    const { rows: pmRows } = await pool.query('SELECT * FROM payment_methods WHERE slug = $1 AND active = true', [d.payment_method_slug]);

    if (!assetRows[0]) return res.status(400).json({ error: 'unknown_asset' });
    if (!countryRows[0]) return res.status(400).json({ error: 'unknown_country' });
    if (!currencyRows[0]) return res.status(400).json({ error: 'unknown_currency' });
    if (!pmRows[0]) return res.status(400).json({ error: 'unknown_payment_method' });

    // Spec P5 §7 - tier 4 gates, enforced here at the API, not left to
    // the UI to hide a button. Tiers 1-3 have no gate at all (acceptance
    // criterion 11) - this block only ever runs for risk_tier === 4.
    if (pmRows[0].risk_tier === 4) {
      const { rows: userRows } = await pool.query('SELECT created_at FROM users WHERE id = $1', [req.user!.id]);
      const accountAgeDays = (Date.now() - new Date(userRows[0].created_at).getTime()) / (24 * 60 * 60 * 1000);
      if (accountAgeDays < TIER_4_NEW_ACCOUNT_MIN_AGE_DAYS) {
        return res.status(403).json({ error: 'tier4_account_too_new' });
      }

      const { rows: statsRows } = await pool.query('SELECT total_trades FROM vendor_stats WHERE user_id = $1', [req.user!.id]);
      const totalTrades = statsRows[0]?.total_trades ?? 0;
      if (totalTrades < TIER_4_MIN_REPUTATION_TRADES) {
        return res.status(403).json({ error: 'tier4_insufficient_reputation' });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO offers (
         vendor_id, side, asset_id, country_id, fiat_currency_id, payment_method_id,
         price_type, price, margin_percent, min_amount, max_amount, total_available,
         terms, payment_window_hours, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active')
       RETURNING id, status`,
      [
        req.user!.id, d.side, assetRows[0].id, countryRows[0].id, currencyRows[0].id, pmRows[0].id,
        d.price_type, d.price ?? null, d.margin_percent ?? null, d.min_amount, d.max_amount, d.total_available,
        d.terms ?? null, d.payment_window_hours,
      ]
    );

    res.status(201).json(rows[0]);
  }
);

// ---- GET /offers/mine ----
// Spec's browse endpoint only ever shows status='active' offers - a
// paused/withdrawn offer of yours needs its own read path, since it
// would never appear in the public listing at all.
offersRouter.get('/offers/mine', requireSession, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.side, o.status, o.paused_reason, o.price_type, o.price, o.margin_percent,
            o.min_amount, o.max_amount, o.total_available, o.payment_window_hours, o.created_at,
            a.symbol AS asset_symbol, c.slug AS country_slug, cur.code AS currency_code,
            pm.name AS payment_method_name
     FROM offers o
     JOIN assets a ON a.id = o.asset_id
     JOIN countries c ON c.id = o.country_id
     JOIN currencies cur ON cur.id = o.fiat_currency_id
     JOIN payment_methods pm ON pm.id = o.payment_method_id
     WHERE o.vendor_id = $1
     ORDER BY o.created_at DESC`,
    [req.user!.id]
  );
  res.json({ offers: rows });
});

// ---- GET /offers ----
// Spec §5.1 - filter by side, asset, country, fiat currency, payment
// method, amount. Sort by price, or (once P5 landed) by completion rate
// / release time - see the sort handling below, which pulls from
// vendor_stats via getSerializedReputationBatch.
const browseSchema = z.object({
  side: z.enum(['buy', 'sell']).optional(),
  asset: z.string().optional(),
  country: z.string().optional(),
  currency: z.string().optional(),
  payment_method: z.string().optional(),
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  // Spec §5.1 was "price only" in P3; P5 §9 acceptance criterion 13
  // adds completion rate and release time now that vendor_stats exists.
  sort: z.enum(['price_asc', 'price_desc', 'completion_rate', 'release_time']).optional(),
});

offersRouter.get('/offers', async (req, res) => {
  const parsed = browseSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const f = parsed.data;

  const conditions: string[] = [`o.status = 'active'`];
  const params: unknown[] = [];
  let i = 1;

  if (f.side) { conditions.push(`o.side = $${i++}`); params.push(f.side); }
  if (f.asset) { conditions.push(`a.slug = $${i++}`); params.push(f.asset); }
  if (f.country) { conditions.push(`c.slug = $${i++}`); params.push(f.country); }
  if (f.currency) { conditions.push(`cur.code = $${i++}`); params.push(f.currency.toUpperCase()); }
  if (f.payment_method) { conditions.push(`pm.slug = $${i++}`); params.push(f.payment_method); }
  if (f.amount) {
    conditions.push(`o.min_amount <= $${i} AND o.max_amount >= $${i}`);
    params.push(f.amount);
    i++;
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.side, o.price_type, o.price, o.margin_percent, o.min_amount, o.max_amount,
            o.payment_window_hours, o.terms, o.vendor_id,
            a.symbol AS asset_symbol, a.slug AS asset_slug,
            c.slug AS country_slug, cur.code AS currency_code, cur.decimal_places,
            pm.name AS payment_method_name, pm.slug AS payment_method_slug
     FROM offers o
     JOIN assets a ON a.id = o.asset_id
     JOIN countries c ON c.id = o.country_id
     JOIN currencies cur ON cur.id = o.fiat_currency_id
     JOIN payment_methods pm ON pm.id = o.payment_method_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY o.created_at DESC
     LIMIT 200`,
    params
  );

  // Spec P5 §9 acceptance criterion 12 - one batched reputation query
  // for the whole page, not one per listing.
  const reputationByVendor = await getSerializedReputationBatch(rows.map((r) => r.vendor_id));

  // Resolve current price per row (margin offers need the live feed;
  // §5.2 - a listing without a resolvable price shouldn't render as if
  // it had one). Sequential to respect the price feed's own 60s cache
  // rather than hammering it per-offer on every browse request.
  const withPrices = [];
  for (const row of rows) {
    const currentPrice = await resolveOfferPrice({
      price_type: row.price_type, price: row.price, margin_percent: row.margin_percent, asset_symbol: row.asset_symbol, currency_code: row.currency_code,
    });
    if (row.price_type === 'margin' && currentPrice === null) continue; // feeds down — spec §3.2: don't show it, don't serve stale
    withPrices.push({ ...row, current_price: currentPrice, vendor_reputation: reputationByVendor.get(row.vendor_id) });
  }

  if (f.sort === 'price_asc') withPrices.sort((a, b) => (a.current_price ?? 0) - (b.current_price ?? 0));
  if (f.sort === 'price_desc') withPrices.sort((a, b) => (b.current_price ?? 0) - (a.current_price ?? 0));
  if (f.sort === 'completion_rate') {
    withPrices.sort((a, b) => (b.vendor_reputation?.completion_rate_30d ?? 0) - (a.vendor_reputation?.completion_rate_30d ?? 0));
  }
  if (f.sort === 'release_time') {
    // Ascending - faster release time is better, nulls (never measured) sort last.
    withPrices.sort((a, b) => {
      const av = a.vendor_reputation?.avg_release_seconds;
      const bv = b.vendor_reputation?.avg_release_seconds;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    });
  }

  res.json({ offers: withPrices });
});

// ---- GET /offers/:id ----
offersRouter.get('/offers/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.*, a.symbol AS asset_symbol, cur.code AS currency_code, cur.decimal_places
     FROM offers o
     JOIN assets a ON a.id = o.asset_id
     JOIN currencies cur ON cur.id = o.fiat_currency_id
     WHERE o.id = $1`,
    [req.params.id]
  );
  const offer = rows[0];
  if (!offer) return res.status(404).json({ error: 'not_found' });

  const currentPrice = await resolveOfferPrice({
    price_type: offer.price_type, price: offer.price, margin_percent: offer.margin_percent, asset_symbol: offer.asset_symbol, currency_code: offer.currency_code,
  });

  res.json({ ...offer, current_price: currentPrice });
});

// ---- POST /offers/:id/pause, /withdraw, /reactivate ----
offersRouter.post('/offers/:id/pause', requireSession, async (req, res) => {
  const result = await pool.query(
    `UPDATE offers SET status = 'paused', paused_reason = 'vendor_requested', updated_at = now()
     WHERE id = $1 AND vendor_id = $2 RETURNING id`,
    [req.params.id, req.user!.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ status: 'paused' });
});

offersRouter.post('/offers/:id/withdraw', requireSession, async (req, res) => {
  const result = await pool.query(
    `UPDATE offers SET status = 'withdrawn', updated_at = now()
     WHERE id = $1 AND vendor_id = $2 RETURNING id`,
    [req.params.id, req.user!.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ status: 'withdrawn' });
});

offersRouter.post('/offers/:id/reactivate', requireSession, async (req, res) => {
  const result = await pool.query(
    `UPDATE offers SET status = 'active', paused_reason = NULL, updated_at = now()
     WHERE id = $1 AND vendor_id = $2 AND status = 'paused' RETURNING id`,
    [req.params.id, req.user!.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'not_found_or_not_paused' });
  res.json({ status: 'active' });
});
