import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireSession } from '../middleware/auth';
import { isStaffOrOwner } from '../lib/roles';
import { idParam } from '../lib/params';

export const disputesRouter = Router();

// Staff access requires 2FA on the staff account.
async function requireStaffOrOwner(req: import('express').Request, res: import('express').Response): Promise<boolean> {
  if (!(await isStaffOrOwner(req.user!.id))) {
    res.status(403).json({ error: 'staff_or_owner_only' });
    return false;
  }
  return true;
}

// ---- POST /disputes/:contractId/recommend ----
// Spec §3.2 - "staff cannot move funds. The recommendation is recorded
// on the dispute; the Owner decides." This is the entire mechanism -
// no fund-moving capability exists on this route.
const recommendSchema = z.object({
  outcome: z.enum(['buyer', 'funder']),
  reason: z.string().trim().min(1),
});

disputesRouter.post('/disputes/:contractId/recommend', requireSession, async (req, res) => {
  if (!(await requireStaffOrOwner(req, res))) return;

  const parsed = recommendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const result = await pool.query(
    `UPDATE disputes
     SET staff_recommendation = $1, recommended_by = $2, recommendation_reason = $3
     WHERE contract_id = $4
     RETURNING id`,
    [parsed.data.outcome, req.user!.id, parsed.data.reason, idParam(req, 'contractId')]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'dispute_not_found' });

  res.json({ status: 'recorded' });
});

// ---- GET /disputes/:contractId/resolution-view ----
// Spec §3.5 - everything a moderator needs, in one response, without
// navigating away: chat with system messages inline, contract state and
// every timestamp, escrow address/funding/confirmations, both parties'
// evidence, payment method context, both parties' trade counts and
// account ages, and - "not cosmetic" - destination and amount
// prominently, for comparison against the Ledger screen during arbitration.
disputesRouter.get('/disputes/:contractId/resolution-view', requireSession, async (req, res) => {
  if (!(await requireStaffOrOwner(req, res))) return;

  const { rows: contractRows } = await pool.query(
    `SELECT c.*, cur.code AS fiat_currency_code, pm.name AS payment_method_name,
            pm.reversal_window_days, pm.risk_tier
     FROM contracts c
     LEFT JOIN currencies cur ON cur.id = c.fiat_currency_id
     LEFT JOIN offers o ON o.id = c.offer_id
     LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
     WHERE c.id = $1`,
    [idParam(req, 'contractId')]
  );
  const contract = contractRows[0];
  if (!contract) return res.status(404).json({ error: 'not_found' });

  const [dispute, messages, transitions, evidence, vendorStats, customerStats, vendorInfo, customerInfo] = await Promise.all([
    pool.query('SELECT * FROM disputes WHERE contract_id = $1', [idParam(req, 'contractId')]),
    pool.query(
      `SELECT id, sender_type, sender_id, body, attachment_id, created_at FROM messages WHERE contract_id = $1 ORDER BY created_at ASC`,
      [idParam(req, 'contractId')]
    ),
    pool.query(
      `SELECT from_state, to_state, actor_type, actor_id, reason, created_at FROM contract_transitions WHERE contract_id = $1 ORDER BY created_at ASC`,
      [idParam(req, 'contractId')]
    ),
    pool.query(
      `SELECT id, uploader_id, mime_type, original_filename, created_at FROM attachments WHERE contract_id = $1`,
      [idParam(req, 'contractId')]
    ),
    // Spec §3.5 - "both parties' trade counts and account ages." Trade
    // count via completed contracts; reputation scoring itself is P5 -
    // this is just the raw counts P5 will later build on.
    pool.query(`SELECT COUNT(*) AS trade_count FROM contracts WHERE (vendor_id = $1 OR customer_id = $1) AND state = 'released'`, [contract.vendor_id]),
    pool.query(`SELECT COUNT(*) AS trade_count FROM contracts WHERE (vendor_id = $1 OR customer_id = $1) AND state = 'released'`, [contract.customer_id]),
    pool.query('SELECT username, created_at FROM users WHERE id = $1', [contract.vendor_id]),
    pool.query('SELECT username, created_at FROM users WHERE id = $1', [contract.customer_id]),
  ]);

  // The escrow funding tx pays the CONTRACT's escrow address, not either
  // party's personal P1 wallet - it was never going to be in the
  // `transactions` table, which only tracks personal wallet activity.
  // Live confirmation count from the chain adapter is the correct source.
  let confirmations: number | null = null;
  if (contract.funding_txid && (contract.chain === 'bitcoin' || contract.chain === 'litecoin')) {
    try {
      const { getAdapter } = await import('../chain');
      confirmations = await getAdapter(contract.chain).getConfirmations(contract.funding_txid);
    } catch (err) {
      console.error('confirmation lookup failed for resolution view', err);
    }
  }

  const funderIsVendor = contract.crypto_side === 'vendor';
  const funderId = funderIsVendor ? contract.vendor_id : contract.customer_id;
  const buyerId = funderIsVendor ? contract.customer_id : contract.vendor_id;

  const history = await pool.query(
    'SELECT id, author_id, details, created_at FROM payment_instructions WHERE contract_id = $1 ORDER BY id',
    [contract.id]);
  const payouts = await pool.query('SELECT party, payout_address FROM contract_keys WHERE contract_id = $1', [contract.id]);
  const addresses = Object.fromEntries(payouts.rows.map((k: any) => [k.party, k.payout_address]));
  res.json({
    payment_instructions: history.rows,
    contract: {
      id: contract.id, reference: contract.reference, state: contract.state, asset: contract.asset, chain: contract.chain,
      amount: contract.amount, fee_amount: contract.fee_amount, fiat_amount: contract.fiat_amount,
      fiat_currency_code: contract.fiat_currency_code, price_snapshot: contract.price_snapshot,
      escrow_address: contract.escrow_address, funding_txid: contract.funding_txid,
      funding_confirmations: confirmations,
      created_at: contract.created_at, accepted_at: contract.accepted_at, funded_at: contract.funded_at,
      paid_at: contract.paid_at, closed_at: contract.closed_at,
      payment_method: contract.payment_method_name, reversal_window_days: contract.reversal_window_days, risk_tier: contract.risk_tier,
    },
    // Prominent, per spec §3.5's explicit callout - the field a Ledger
    // screen comparison actually needs, not buried in the contract blob.
    destination_for_arbitration: {
      buyer_address: addresses[funderIsVendor ? 'customer' : 'vendor'] ?? null,
      funder_address: addresses[contract.crypto_side] ?? null,
      buyer_id: buyerId,
      funder_id: funderId,
      amount: contract.amount,
      asset: contract.asset,
    },
    dispute: dispute.rows[0] ?? null,
    chat: messages.rows,
    transitions: transitions.rows,
    evidence: evidence.rows,
    parties: {
      vendor: { id: contract.vendor_id, username: vendorInfo.rows[0]?.username, account_created_at: vendorInfo.rows[0]?.created_at, completed_trades: Number(vendorStats.rows[0]?.trade_count ?? 0) },
      customer: { id: contract.customer_id, username: customerInfo.rows[0]?.username, account_created_at: customerInfo.rows[0]?.created_at, completed_trades: Number(customerStats.rows[0]?.trade_count ?? 0) },
    },
  });
});

// ---- GET /disputes ----
// Staff/Owner queue - every open dispute, oldest first (spec §3.3's
// service-level targets run from opening, so oldest-first surfaces
// what's closest to breaching them).
disputesRouter.get('/disputes', requireSession, async (req, res) => {
  if (!(await requireStaffOrOwner(req, res))) return;

  const { rows } = await pool.query(
    `SELECT d.contract_id, d.reason_code, d.opened_at, d.escalated_at, d.staff_recommendation,
            c.reference, c.asset, c.state
     FROM disputes d JOIN contracts c ON c.id = d.contract_id
     WHERE c.state = 'disputed'
     ORDER BY d.opened_at ASC`
  );
  res.json({ disputes: rows });
});
