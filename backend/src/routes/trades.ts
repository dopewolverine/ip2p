import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { requireSession } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { resolveOfferPrice } from '../marketplace/pricing';
import { computeFee, checkMinTrade } from '../escrow/feeConfig';
import { applyTransition, TransitionError } from '../escrow/applyTransition';
import { resolveIdempotencyKey } from '../escrow/idempotency';
import { emitNotification } from '../lib/notifications';
import { hasAdminRole } from '../lib/roles';
import { decimalToScaled } from '../lib/amounts';
import { idParam } from '../lib/params';

export const tradesRouter = Router();

// Escrow exists only for Bitcoin and Litecoin. EVM/Tron
// contract escrow is blocked on the P2 prerequisite (reading and verifying
// the LocalCoinSwap contract), so trades on those chains can't be opened.
const ESCROW_CHAINS = new Set(['bitcoin', 'litecoin']);

const CHAIN_FOR: Record<string, string> = {
  BTC: 'bitcoin', LTC: 'litecoin', ETH: 'ethereum',
  USDT_ERC20: 'ethereum', USDC_ERC20: 'ethereum', USDT_TRC20: 'tron',
};

function genReference(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[randomBytes(1)[0]! % chars.length];
  return `TR-${s}`;
}

const FIAT_SCALE = 8; // fiat columns are numeric(24,8)

// ---- POST /trades/request ----
const requestSchema = z.object({
  offer_id: z.string().uuid(),
  fiat_amount: z.string().regex(/^\d{1,16}(\.\d{1,8})?$/),
});

tradesRouter.post(
  '/trades/request',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => `trade_request:${req.user!.id}` }),
  async (req, res) => {
    if (req.user!.status === 'pending_deletion') return res.status(409).json({ error: 'account_pending_deletion' });
    if (!env.tradingOpen) return res.status(403).json({ error: 'trading_closed', message: 'Trading is temporarily closed.' });
    // DEV-BRIEF §4A - separate accounts for trading and administration.
    if (await hasAdminRole(req.user!.id)) return res.status(403).json({ error: 'staff_accounts_cannot_trade' });

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    const { offer_id, fiat_amount } = parsed.data;
    const customerId = req.user!.id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: offerRows } = await client.query(
        `SELECT o.*, a.symbol AS asset_symbol, a.chain AS asset_chain, a.decimals AS asset_decimals,
                cur.code AS currency_code, pm.max_trade_amount, pm.risk_tier, pm.requires_evidence
         FROM offers o
         JOIN assets a ON a.id = o.asset_id
         JOIN currencies cur ON cur.id = o.fiat_currency_id
         JOIN payment_methods pm ON pm.id = o.payment_method_id
         WHERE o.id = $1 FOR UPDATE OF o`,
        [offer_id]
      );
      const offer = offerRows[0];
      const fail = async (status: number, error: string) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };

      if (!offer) return fail(404, 'offer_not_found');
      if (offer.status !== 'active') return fail(409, 'offer_not_active');
      if (offer.vendor_id === customerId) return fail(400, 'cannot_request_own_offer');
      // Serialize creation against account deletion, locking users in UUID order.
      const parties = await client.query('SELECT id, status FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[offer.vendor_id, customerId]]);
      if (parties.rows.length !== 2 || parties.rows.some(u => u.status !== 'active')) return fail(409, 'account_unavailable');


      const chain = CHAIN_FOR[offer.asset_symbol];
      if (!chain || !ESCROW_CHAINS.has(chain)) return fail(409, 'asset_not_tradeable_yet');

      // Integer arithmetic only (P2 §4A.7).
      const fiatScaled = decimalToScaled(fiat_amount, FIAT_SCALE);
      if (fiatScaled <= 0n) return fail(400, 'invalid_amount');
      if (fiatScaled < decimalToScaled(offer.min_amount, FIAT_SCALE) || fiatScaled > decimalToScaled(offer.max_amount, FIAT_SCALE)) {
        return fail(400, 'amount_out_of_range');
      }
      // Spec P5 §7 - per-trade ceiling, server-side.
      if (offer.max_trade_amount !== null && fiatScaled > decimalToScaled(offer.max_trade_amount, FIAT_SCALE)) {
        return fail(400, 'exceeds_tier_ceiling');
      }

      const currentPrice = await resolveOfferPrice({
        price_type: offer.price_type, price: offer.price, margin_percent: offer.margin_percent, asset_symbol: offer.asset_symbol, currency_code: offer.currency_code,
      });
      if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) return fail(409, 'price_unavailable');

      const decimals = Number(offer.asset_decimals);
      const priceScaled = decimalToScaled(currentPrice.toFixed(FIAT_SCALE), FIAT_SCALE);
      if (priceScaled <= 0n) return fail(409, 'price_unavailable');
      const cryptoAmountBase = (fiatScaled * 10n ** BigInt(decimals)) / priceScaled;

      if (!checkMinTrade(chain, cryptoAmountBase.toString())) return fail(400, 'below_minimum_trade');

      // P3 §3.5: total_available is the vendor's ceiling in whole coins; the
      // committed sum is in base units, so both are compared in base units.
      const { rows: committedRows } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::text AS committed
         FROM contracts WHERE offer_id = $1 AND state IN ('accepted', 'funded', 'paid', 'disputed')`,
        [offer_id]
      );
      const committed = BigInt(committedRows[0].committed);
      const totalAvailableBase = decimalToScaled(offer.total_available, decimals);
      if (committed + cryptoAmountBase > totalAvailableBase) return fail(409, 'exceeds_total_available');

      const { feeAmount, feeRateBps } = computeFee(chain, cryptoAmountBase.toString());
      const cryptoSide = offer.side === 'sell' ? 'vendor' : 'customer';

      const { rows: contractRows } = await client.query(
        `INSERT INTO contracts (
           reference, escrow_version, offer_id, vendor_id, customer_id, crypto_side, asset, chain,
           amount, fee_amount, fee_rate_bps, fiat_currency_id, fiat_amount, price_snapshot,
           payment_window_hours, contract_index, state
         ) VALUES ($1, 2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           nextval('contract_index_seq'), 'requested')
         RETURNING id, reference, state`,
        [
          genReference(), offer_id, offer.vendor_id, customerId, cryptoSide, offer.asset_symbol, chain,
          cryptoAmountBase.toString(), feeAmount, feeRateBps, offer.fiat_currency_id, fiat_amount,
          currentPrice.toFixed(FIAT_SCALE), offer.payment_window_hours,
        ]
      );

      await emitNotification(client, {
        userId: offer.vendor_id, type: 'trade_requested', priority: 'critical',
        contractId: contractRows[0].id, payload: { reference: contractRows[0].reference },
      });

      await client.query('COMMIT');
      res.status(201).json(contractRows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
);

// ---- POST /trades/:id/accept ---- vendor only; the offer must still be active.
const acceptSchema = z.object({ payment_window_hours: z.number().int().min(1).max(72).optional() });

tradesRouter.post('/trades/:id/accept', requireSession, async (req, res) => {
  const id = idParam(req);
  const parsed = acceptSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const { rows } = await pool.query(
    `SELECT c.vendor_id, c.offer_id, c.state, o.status AS offer_status
     FROM contracts c LEFT JOIN offers o ON o.id = c.offer_id WHERE c.id = $1`,
    [id]
  );
  const contract = rows[0];
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (contract.vendor_id !== req.user!.id) return res.status(403).json({ error: 'vendor_only' });
  if (contract.offer_id && contract.offer_status !== 'active') return res.status(409).json({ error: 'offer_no_longer_active' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (contract.offer_id) {
      const { rows: offerRows } = await client.query(
        `SELECT o.status, o.total_available, a.decimals FROM offers o
         JOIN assets a ON a.id = o.asset_id WHERE o.id = $1 FOR UPDATE OF o`, [contract.offer_id]);
      const offer = offerRows[0];
      if (!offer || offer.status !== 'active') throw new TransitionError('offer_no_longer_active', 'Offer is no longer active');
      const { rows: requested } = await client.query('SELECT amount FROM contracts WHERE id = $1', [id]);
      const { rows: used } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::text AS amount FROM contracts
         WHERE offer_id = $1 AND state IN ('accepted', 'funded', 'paid', 'disputed') AND id <> $2`,
        [contract.offer_id, id]);
      if (BigInt(used[0].amount) + BigInt(requested[0].amount) > decimalToScaled(offer.total_available, Number(offer.decimals))) {
        throw new TransitionError('exceeds_total_available', 'Offer capacity has already been reserved');
      }
    }
    if (parsed.data.payment_window_hours) {
      await client.query(
        `UPDATE contracts SET payment_window_hours = $1 WHERE id = $2 AND state = 'requested'`,
        [parsed.data.payment_window_hours, id]
      );
    }
    const state = await applyTransition({
      contractId: id, trigger: 'vendor_accepts', actorType: 'user', actorId: req.user!.id, reason: null,
      idempotencyKey: resolveIdempotencyKey(req.body?.idempotency_key),
    }, client);
    await client.query('COMMIT');
    res.json({ state });
  } catch (err) {
    await client.query('ROLLBACK');
    handleErr(err, res);
  } finally {
    client.release();
  }
});

// ---- POST /trades/:id/decline ----
tradesRouter.post('/trades/:id/decline', requireSession, async (req, res) => {
  const id = idParam(req);
  const { rows } = await pool.query('SELECT vendor_id FROM contracts WHERE id = $1', [id]);
  const contract = rows[0];
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (contract.vendor_id !== req.user!.id) return res.status(403).json({ error: 'vendor_only' });
  try {
    const state = await applyTransition({
      contractId: id, trigger: 'cancel_requested', actorType: 'user', actorId: req.user!.id,
      reason: 'declined by vendor', idempotencyKey: resolveIdempotencyKey(req.body?.idempotency_key),
    });
    res.json({ state });
  } catch (err) {
    handleErr(err, res);
  }
});

tradesRouter.get('/trades/incoming', requireSession, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, reference, asset, chain, amount, fiat_amount, price_snapshot,
            payment_window_hours, state, created_at, offer_id
     FROM contracts WHERE vendor_id = $1 AND state = 'requested' ORDER BY created_at ASC`,
    [req.user!.id]
  );
  res.json({ trades: rows });
});

tradesRouter.get('/trades/mine', requireSession, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, reference, asset, chain, amount, fiat_amount, state, vendor_id, customer_id, created_at
     FROM contracts WHERE vendor_id = $1 OR customer_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.user!.id]
  );
  res.json({ trades: rows });
});

// ---- POST /trades/:id/dispute ---- either party, from funded or paid.
const DISPUTE_REASON_CODES = ['no_payment_received', 'payment_not_recognized', 'wrong_amount', 'counterparty_unresponsive', 'other'] as const;
const disputeSchema = z.object({
  reason_code: z.enum(DISPUTE_REASON_CODES),
  reason_text: z.string().trim().min(1).max(2000),
});

tradesRouter.post('/trades/:id/dispute', requireSession, async (req, res) => {
  const id = idParam(req);
  const parsed = disputeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', message: parsed.error.issues[0]?.message });

  const { rows } = await pool.query('SELECT vendor_id, customer_id FROM contracts WHERE id = $1', [id]);
  const contract = rows[0];
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (![contract.vendor_id, contract.customer_id].includes(req.user!.id)) return res.status(403).json({ error: 'not_a_party' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await applyTransition({
      contractId: id, trigger: 'dispute_raised', actorType: 'user', actorId: req.user!.id,
      reason: parsed.data.reason_text, idempotencyKey: resolveIdempotencyKey(req.body?.idempotency_key),
    }, client);
    await client.query(
      `INSERT INTO disputes (contract_id, opened_by, reason_code, reason_text) VALUES ($1, $2, $3, $4)
       ON CONFLICT (contract_id) DO NOTHING`,
      [id, req.user!.id, parsed.data.reason_code, parsed.data.reason_text]
    );
    await client.query('COMMIT');
    res.json({ state });
  } catch (err) {
    await client.query('ROLLBACK');
    handleErr(err, res);
  } finally {
    client.release();
  }
});

// ---- POST /trades/:id/payment-details ----
// Chat filters emails, phone
// numbers and account-number-like digits, which are exactly the details a
// buyer needs to pay by bank, Zelle, PayPal or Revolut. The crypto side
// (who receives the fiat) records them here. The fiat side sees them only
// once escrow is funded; they are not filtered, and staff see them in a
// dispute.
const detailsSchema = z.object({ details: z.string().trim().min(1).max(1000) });

tradesRouter.post(
  '/trades/:id/payment-details',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `payment_details:${req.user!.id}` }),
  async (req, res) => {
    const id = idParam(req);
    const parsed = detailsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    const { rows } = await pool.query('SELECT reference, vendor_id, customer_id, crypto_side, state FROM contracts WHERE id = $1', [id]);
    const c = rows[0];
    if (!c) return res.status(404).json({ error: 'not_found' });
    const cryptoSideId = c.crypto_side === 'vendor' ? c.vendor_id : c.customer_id;
    const fiatSideId = c.crypto_side === 'vendor' ? c.customer_id : c.vendor_id;
    if (cryptoSideId !== req.user!.id) return res.status(403).json({ error: 'crypto_side_only' });
    if (!['requested', 'accepted', 'funded'].includes(c.state)) return res.status(409).json({ error: 'wrong_state' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: locked } = await client.query('SELECT state FROM contracts WHERE id = $1 FOR UPDATE', [id]);
      if (!['requested', 'accepted', 'funded'].includes(locked[0]?.state)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'payment_details_locked' });
      }
      await client.query('INSERT INTO payment_instructions (contract_id, author_id, details) VALUES ($1, $2, $3)',
        [id, req.user!.id, parsed.data.details]);
      await client.query(
        `UPDATE contracts SET payment_details = $1, payment_details_set_at = now() WHERE id = $2`,
        [parsed.data.details, id]
      );
      await client.query(
        `INSERT INTO messages (contract_id, sender_type, sender_id, body)
         VALUES ($1, 'system', NULL, 'The seller updated the payment details. The buyer sees them once escrow is funded.')`,
        [id]
      );
      if (c.state === 'funded' || c.state === 'paid') {
        await emitNotification(client, {
          userId: fiatSideId, type: 'payment_details_shared', priority: 'critical', contractId: id,
          payload: { reference: c.reference }, dedupeKey: `${Date.now()}`,
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ status: 'ok' });
  }
);

function handleErr(err: unknown, res: import('express').Response) {
  if (err instanceof TransitionError) {
    const statusByCode: Record<string, number> = { not_found: 404, terminal_contract: 409, invalid_transition: 409, duplicate_request: 409, exceeds_total_available: 409, offer_no_longer_active: 409 };
    return res.status(statusByCode[err.code] ?? 400).json({ error: err.code, message: err.message });
  }
  throw err;
}
