import { Router, Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { requireSession } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { applyTransition, TransitionError } from '../escrow/applyTransition';
import { resolveIdempotencyKey } from '../escrow/idempotency';
import { computeFee, checkMinTrade } from '../escrow/feeConfig';
import {
  buildEscrowScriptFor, derivePlatformPubkey, expectedEscrowPath, isCompressedPubkey, parseContractIndex,
} from '../escrow/multisig';
import { watchEscrowAddress, checkContractFunding } from '../escrow/fundingMonitor';
import { networkReserveFor } from '../escrow/releaseTx';
import {
  getOrCreateProposal, getProposal, submitSignature, discardProposal, EscrowError, Purpose,
} from '../escrow/releaseProposal';
import { recordSecurityAlert } from '../escrow/alerts';
import { isValidUtxoAddress, UtxoChain } from '../chain/networks';
import { getAdapter } from '../chain';
import type { BitcoinAdapter } from '../chain/bitcoinAdapter';
import { idParam } from '../lib/params';

export const escrowRouter = Router();

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

async function partyOf(contractId: string, userId: string) {
  const { rows } = await pool.query('SELECT * FROM contracts WHERE id = $1', [contractId]);
  const contract = rows[0];
  if (!contract) return { contract: null, party: null as null };
  const party: 'vendor' | 'customer' | null =
    contract.vendor_id === userId ? 'vendor' : contract.customer_id === userId ? 'customer' : null;
  return { contract, party };
}

function handleError(err: unknown, res: Response) {
  if (err instanceof TransitionError) {
    const statusByCode: Record<string, number> = { not_found: 404, terminal_contract: 409, invalid_transition: 409, duplicate_request: 409 };
    return res.status(statusByCode[err.code] ?? 400).json({ error: err.code, message: err.message });
  }
  if (err instanceof EscrowError) return res.status(err.status).json({ error: err.code });
  throw err;
}

// ---- Engine-testing endpoints (P2 §1) ----
// These let any user open a contract naming ANY other user, with any
// terms, and self-accept it - unanswered requests then counted against the
// victim's completion rate. Real trades go through P3's /trades/*. These
// only exist when ALLOW_ENGINE_TEST_ENDPOINTS=true (never in production).
const createSchema = z.object({
  counterparty_id: z.string().uuid(),
  crypto_side: z.enum(['vendor', 'customer']),
  asset: z.enum(['BTC', 'LTC', 'ETH', 'USDT_ERC20', 'USDC_ERC20', 'USDT_TRC20']),
  amount: z.string().regex(/^\d+$/),
  fiat_currency_code: z.string().length(3),
  fiat_amount: z.string().regex(/^\d+(\.\d+)?$/),
  price_snapshot: z.string().regex(/^\d+(\.\d+)?$/),
  payment_window_hours: z.number().int().positive().max(72),
});

escrowRouter.post(
  '/escrow/contracts',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => `escrow_create:${req.user!.id}` }),
  async (req, res) => {
    if (!env.allowEngineTestEndpoints) return res.status(404).json({ error: 'not_found' });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    const d = parsed.data;
    const callerId = req.user!.id;
    if (d.counterparty_id === callerId) return res.status(400).json({ error: 'cannot_trade_with_self' });
    const chain = CHAIN_FOR[d.asset]!;
    if (!checkMinTrade(chain, d.amount)) return res.status(400).json({ error: 'below_minimum_trade' });
    const { feeAmount, feeRateBps } = computeFee(chain, d.amount);
    const { rows: currencyRows } = await pool.query('SELECT id FROM currencies WHERE code = $1 AND active = true', [d.fiat_currency_code.toUpperCase()]);
    if (!currencyRows[0]) return res.status(400).json({ error: 'unknown_currency' });
    const vendorId = d.crypto_side === 'vendor' ? callerId : d.counterparty_id;
    const customerId = d.crypto_side === 'customer' ? callerId : d.counterparty_id;
    const { rows } = await pool.query(
      `INSERT INTO contracts (
         reference, escrow_version, vendor_id, customer_id, crypto_side, asset, chain,
         amount, fee_amount, fee_rate_bps, fiat_currency_id, fiat_amount, price_snapshot,
         payment_window_hours, contract_index, state
       ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, nextval('contract_index_seq'), 'requested')
       RETURNING id, reference, state`,
      [genReference(), vendorId, customerId, d.crypto_side, d.asset, chain, d.amount, feeAmount, feeRateBps,
        currencyRows[0].id, d.fiat_amount, d.price_snapshot, d.payment_window_hours]
    );
    res.status(201).json(rows[0]);
  }
);

escrowRouter.post('/escrow/contracts/:id/accept', requireSession, async (req, res) => {
  if (!env.allowEngineTestEndpoints) return res.status(404).json({ error: 'not_found' });
  const id = idParam(req);
  const { contract, party } = await partyOf(id, req.user!.id);
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (party !== 'vendor') return res.status(403).json({ error: 'vendor_only' });
  try {
    const state = await applyTransition({
      contractId: id, trigger: 'vendor_accepts', actorType: 'user', actorId: req.user!.id, reason: null,
      idempotencyKey: resolveIdempotencyKey(req.body?.idempotency_key),
    });
    res.json({ state });
  } catch (err) { handleError(err, res); }
});

escrowRouter.post('/escrow/contracts/:id/dispute', requireSession, async (req, res) => {
  if (!env.allowEngineTestEndpoints) return res.status(404).json({ error: 'not_found' });
  const id = idParam(req);
  const { contract, party } = await partyOf(id, req.user!.id);
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (!party) return res.status(403).json({ error: 'not_a_party' });
  try {
    const state = await applyTransition({
      contractId: id, trigger: 'dispute_raised', actorType: 'user', actorId: req.user!.id,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
      idempotencyKey: resolveIdempotencyKey(req.body?.idempotency_key),
    });
    res.json({ state });
  } catch (err) { handleError(err, res); }
});

// ---- POST /escrow/contracts/:id/cancel - either party, pre-funding only (state machine) ----
escrowRouter.post('/escrow/contracts/:id/cancel', requireSession, async (req, res) => {
  const id = idParam(req);
  const { contract, party } = await partyOf(id, req.user!.id);
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (!party) return res.status(403).json({ error: 'not_a_party' });
  try {
    const state = await applyTransition({
      contractId: id, trigger: 'cancel_requested', actorType: 'user', actorId: req.user!.id,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
      idempotencyKey: resolveIdempotencyKey(req.body?.idempotency_key),
    });
    res.json({ state });
  } catch (err) { handleError(err, res); }
});

// ---- POST /escrow/contracts/:id/keys ----
// Spec §4.1 steps 2-7. FIX: the payout address is recorded with the key
// (P2 §4A.1 checks the recipient "against the counterparty address from the
// contract" - the data model had no such field); the derivation path must
// be the canonical one; the pubkey must be a real curve point.
const keysSchema = z.object({
  public_key: z.string().regex(/^[0-9a-fA-F]{66}$/),
  derivation_path: z.string().min(1).max(64),
  payout_address: z.string().min(1).max(100),
});

escrowRouter.post(
  '/escrow/contracts/:id/keys',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => `escrow_keys:${req.user!.id}` }),
  async (req, res) => {
    const id = idParam(req);
    const parsed = keysSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const { contract, party } = await partyOf(id, req.user!.id);
    if (!contract) return res.status(404).json({ error: 'not_found' });
    if (!party) return res.status(403).json({ error: 'not_a_party' });
    if (contract.chain !== 'bitcoin' && contract.chain !== 'litecoin') return res.status(400).json({ error: 'not_a_multisig_chain' });
    if (contract.state !== 'accepted') return res.status(409).json({ error: 'wrong_state' });
    if (contract.escrow_address) return res.status(409).json({ error: 'address_already_generated' });

    const chain = contract.chain as UtxoChain;
    const contractIndex = parseContractIndex(contract.contract_index);
    if (parsed.data.derivation_path !== expectedEscrowPath(chain, contractIndex)) {
      return res.status(400).json({ error: 'unexpected_derivation_path' });
    }
    if (!isCompressedPubkey(parsed.data.public_key)) return res.status(400).json({ error: 'invalid_public_key' });
    if (!isValidUtxoAddress(parsed.data.payout_address, chain)) return res.status(400).json({ error: 'invalid_payout_address' });

    let fastRate: bigint | null = null;
    try {
      fastRate = BigInt((await (getAdapter(chain) as BitcoinAdapter).estimateFee(chain === 'bitcoin' ? 'BTC' : 'LTC', 'fast')).fast);
    } catch {
      fastRate = null; // falls back to a conservative reserve rate
    }

    const client = await pool.connect();
    let generated: { address: string; witnessScript: string; reserve: bigint } | null = null;
    try {
      await client.query('BEGIN');
      const { rows: lockRows } = await client.query('SELECT state, escrow_address FROM contracts WHERE id = $1 FOR UPDATE', [id]);
      if (lockRows[0]?.state !== 'accepted' || lockRows[0]?.escrow_address) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'wrong_state' });
      }

      await client.query(
        `INSERT INTO contract_keys (contract_id, party, public_key, derivation_path, payout_address)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (contract_id, party) DO UPDATE
           SET public_key = EXCLUDED.public_key, derivation_path = EXCLUDED.derivation_path, payout_address = EXCLUDED.payout_address`,
        [id, party, parsed.data.public_key.toLowerCase(), parsed.data.derivation_path, parsed.data.payout_address]
      );

      const { rows: platformKeyRows } = await client.query(`SELECT 1 FROM contract_keys WHERE contract_id = $1 AND party = 'platform'`, [id]);
      if (!platformKeyRows[0]) {
        const { rows: xpubRows } = await client.query(
          `SELECT xpub, derivation_base FROM platform_keys WHERE chain = $1 AND active = true`, [chain]
        );
        if (!xpubRows[0]) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'no_active_platform_key' });
        }
        const platformPubkey = derivePlatformPubkey(xpubRows[0].xpub, chain, contractIndex);
        await client.query(
          `INSERT INTO contract_keys (contract_id, party, public_key, derivation_path) VALUES ($1, 'platform', $2, $3)`,
          [id, platformPubkey, `${xpubRows[0].derivation_base}/${contractIndex}`]
        );
      }

      const { rows: allKeys } = await client.query('SELECT party, public_key FROM contract_keys WHERE contract_id = $1', [id]);
      const byParty = Object.fromEntries(allKeys.map((k) => [k.party, k.public_key])) as Record<string, string>;
      if (byParty.vendor && byParty.customer && byParty.vendor === byParty.customer) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'duplicate_key' });
      }

      if (byParty.vendor && byParty.customer && byParty.platform) {
        const { witnessScript, address } = buildEscrowScriptFor(chain, [byParty.vendor, byParty.customer, byParty.platform]);
        const reserve = networkReserveFor(chain, fastRate);
        await client.query(
          `UPDATE contracts SET escrow_address = $1, redeem_script = $2, network_reserve = $3 WHERE id = $4`,
          [address, witnessScript, reserve.toString(), id]
        );
        generated = { address, witnessScript, reserve };
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if (!generated) return res.json({ status: 'key_recorded' });
    watchEscrowAddress({ contractId: id, chain, escrowAddress: generated.address });
    res.json({
      status: 'address_generated',
      escrow_address: generated.address,
      witness_script: generated.witnessScript,
      network_reserve: generated.reserve.toString(),
      required_funding: (BigInt(contract.amount) + BigInt(contract.fee_amount) + generated.reserve).toString(),
    });
  }
);

// ---- GET /escrow/contracts/:id ----
escrowRouter.get('/escrow/contracts/:id', requireSession, async (req, res) => {
  const id = idParam(req);
  const { contract, party } = await partyOf(id, req.user!.id);
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (!party) return res.status(403).json({ error: 'not_a_party' });
  const c = { ...contract };
  // Payment details (P4 amendment) reach the fiat side only once escrow is funded.
  const isCryptoSide = c.crypto_side === party;
  if (!isCryptoSide && !['funded', 'paid', 'disputed', 'released'].includes(c.state)) c.payment_details = null;
  c.required_funding = c.escrow_address
    ? (BigInt(c.amount) + BigInt(c.fee_amount) + BigInt(c.network_reserve)).toString()
    : null;
  if (isCryptoSide || !!c.funded_at) {
    const history = await pool.query('SELECT id, author_id, details, created_at FROM payment_instructions WHERE contract_id = $1 ORDER BY id', [id]);
    c.payment_instructions = history.rows;
  } else c.payment_instructions = [];
  const payout = await pool.query(
    `SELECT purpose, status, txid, attempts, last_error FROM broadcasts
     WHERE contract_id = $1 AND status IN ('signed', 'broadcast', 'confirmed') ORDER BY created_at DESC LIMIT 1`, [id]);
  c.settlement = payout.rows[0] ?? null;
  c.my_party = party;
  res.json(c);
});

// ---- GET /escrow/contracts/:id/keys ---- public keys and payout addresses, participant-only.
escrowRouter.get('/escrow/contracts/:id/keys', requireSession, async (req, res) => {
  const id = idParam(req);
  const { contract, party } = await partyOf(id, req.user!.id);
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (!party) return res.status(403).json({ error: 'not_a_party' });
  const { rows } = await pool.query('SELECT party, public_key, payout_address FROM contract_keys WHERE contract_id = $1', [id]);
  const out: Record<string, string | null> = { vendor: null, customer: null, platform: null, vendor_payout: null, customer_payout: null };
  for (const k of rows) {
    out[k.party] = k.public_key;
    if (k.party !== 'platform') out[`${k.party}_payout`] = k.payout_address;
  }
  res.json(out);
});

// ---- POST /escrow/contracts/:id/check-funding ---- "I've sent it": re-check now.
escrowRouter.post(
  '/escrow/contracts/:id/check-funding',
  requireSession,
  rateLimit({ windowMs: 60 * 1000, max: 6, keyFn: (req) => `check_funding:${req.user!.id}` }),
  async (req, res) => {
    const id = idParam(req);
    const { contract, party } = await partyOf(id, req.user!.id);
    if (!contract) return res.status(404).json({ error: 'not_found' });
    if (!party) return res.status(403).json({ error: 'not_a_party' });
    await checkContractFunding(id);
    const { rows } = await pool.query('SELECT state, funding_txid FROM contracts WHERE id = $1', [id]);
    res.json(rows[0]);
  }
);

// ---- POST /escrow/contracts/:id/mark-paid ---- fiat side only.
escrowRouter.post('/escrow/contracts/:id/mark-paid', requireSession, async (req, res) => {
  const id = idParam(req);
  const { rows } = await pool.query(
    `SELECT c.vendor_id, c.customer_id, c.crypto_side, pm.requires_evidence
     FROM contracts c LEFT JOIN offers o ON o.id = c.offer_id LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
     WHERE c.id = $1`,
    [id]
  );
  const contract = rows[0];
  if (!contract) return res.status(404).json({ error: 'not_found' });
  const fiatSideId = contract.crypto_side === 'vendor' ? contract.customer_id : contract.vendor_id;
  if (fiatSideId !== req.user!.id) return res.status(403).json({ error: 'fiat_side_only' });
  if (contract.requires_evidence) {
    const { rows: evidenceRows } = await pool.query(
      'SELECT 1 FROM attachments WHERE contract_id = $1 AND uploader_id = $2 LIMIT 1', [id, req.user!.id]
    );
    if (!evidenceRows[0]) return res.status(400).json({ error: 'evidence_required' });
  }
  try {
    const state = await applyTransition({
      contractId: id, trigger: 'fiat_marked_paid', actorType: 'user', actorId: req.user!.id, reason: null,
      idempotencyKey: resolveIdempotencyKey(req.body?.idempotency_key),
    });
    res.json({ state });
  } catch (err) { handleError(err, res); }
});

// ---- Release / refund proposals (P2 §4.3) ----
// The server builds ONE unsigned PSBT per contract+purpose; each signer's
// browser verifies it against data it already holds (§4A.1), signs it, and
// submits the signature. The server combines only signatures over that
// exact transaction.
const purposeSchema = z.enum(['release', 'refund']);

escrowRouter.post(
  '/escrow/contracts/:id/proposals',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => `proposal:${req.user!.id}` }),
  async (req, res) => {
    const id = idParam(req);
    const purpose = purposeSchema.safeParse(req.body?.purpose);
    if (!purpose.success) return res.status(400).json({ error: 'invalid_input' });
    const { contract, party } = await partyOf(id, req.user!.id);
    if (!contract) return res.status(404).json({ error: 'not_found' });
    if (!party) return res.status(403).json({ error: 'not_a_party' });
    try {
      res.json(await getOrCreateProposal(id, purpose.data as Purpose, party));
    } catch (err) { handleError(err, res); }
  }
);

escrowRouter.get('/escrow/contracts/:id/proposals/:purpose', requireSession, async (req, res) => {
  const id = idParam(req);
  const purpose = purposeSchema.safeParse(req.params.purpose);
  if (!purpose.success) return res.status(400).json({ error: 'invalid_input' });
  const { contract, party } = await partyOf(id, req.user!.id);
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (!party) return res.status(403).json({ error: 'not_a_party' });
  const proposal = await getProposal(id, purpose.data as Purpose);
  if (!proposal) return res.status(404).json({ error: 'no_proposal' });
  res.json(proposal);
});

escrowRouter.post(
  '/escrow/contracts/:id/proposals/:purpose/sign',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `escrow_sign:${req.user!.id}` }),
  async (req, res) => {
    const id = idParam(req);
    const purpose = purposeSchema.safeParse(req.params.purpose);
    const body = z.object({ signed_psbt: z.string().min(1).max(200_000) }).safeParse(req.body);
    if (!purpose.success || !body.success) return res.status(400).json({ error: 'invalid_input' });
    const { contract, party } = await partyOf(id, req.user!.id);
    if (!contract) return res.status(404).json({ error: 'not_found' });
    if (!party) return res.status(403).json({ error: 'not_a_party' });
    try {
      res.json(await submitSignature({
        contractId: id, purpose: purpose.data as Purpose, signer: party,
        signedPsbtBase64: body.data.signed_psbt, actorUserId: req.user!.id,
      }));
    } catch (err) { handleError(err, res); }
  }
);

escrowRouter.delete('/escrow/contracts/:id/proposals/:purpose', requireSession, async (req, res) => {
  const id = idParam(req);
  const purpose = purposeSchema.safeParse(req.params.purpose);
  if (!purpose.success) return res.status(400).json({ error: 'invalid_input' });
  const { contract, party } = await partyOf(id, req.user!.id);
  if (!contract) return res.status(404).json({ error: 'not_found' });
  if (!party) return res.status(403).json({ error: 'not_a_party' });
  try {
    await discardProposal(id, purpose.data as Purpose, party);
    res.json({ status: 'discarded' });
  } catch (err) { handleError(err, res); }
});

// ---- POST /escrow/contracts/:id/security-alert ----
// P2 §4A.1 - a client that refuses to sign reports why. Staff are notified.
escrowRouter.post(
  '/escrow/contracts/:id/security-alert',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `sec_alert:${req.user!.id}` }),
  async (req, res) => {
    const id = idParam(req);
    const body = z.object({ check: z.string().min(1).max(64), details: z.record(z.unknown()).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_input' });
    const { contract, party } = await partyOf(id, req.user!.id);
    if (!contract) return res.status(404).json({ error: 'not_found' });
    if (!party) return res.status(403).json({ error: 'not_a_party' });
    await recordSecurityAlert({ userId: req.user!.id, contractId: id, check: body.data.check, details: body.data.details ?? null });
    res.json({ status: 'recorded' });
  }
);
