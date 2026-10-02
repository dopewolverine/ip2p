import { Router } from 'express';
import { z } from 'zod';
import * as bitcoin from 'bitcoinjs-lib';
import { pool } from '../db/pool';
import { requireSession } from '../middleware/auth';
import { requireOwner, requireStaffOrOwner } from '../middleware/requireOwner';
import { rateLimit } from '../middleware/rateLimit';
import { getOrCreateProposal, submitSignature, EscrowError, Purpose } from '../escrow/releaseProposal';
import { networkFor, UtxoChain } from '../chain/networks';
import { idParam } from '../lib/params';

export const adminRouter = Router();

adminRouter.get('/admin/escrow/disputes', requireSession, requireStaffOrOwner, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, reference, asset, chain, amount, fiat_amount, state, resolution, resolution_reason, created_at
     FROM contracts WHERE state = 'disputed' OR (state = 'cancelled' AND stranded_detected_at IS NOT NULL)
     ORDER BY created_at ASC`
  );
  res.json({ disputes: rows });
});

// Spec §8.1 step 1 - the Owner's decision, recorded before any signature
// exists. "Resolution requires a non-empty reason string."
const decideSchema = z.object({
  winner: z.enum(['buyer', 'funder']),
  reason: z.string().trim().min(1, 'a non-empty reason is required'),
});

adminRouter.post('/admin/escrow/contracts/:id/decide', requireSession, requireOwner, async (req, res) => {
  const id = idParam(req);
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', message: parsed.error.issues[0]?.message });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT state FROM contracts WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new EscrowError('not_found', 404);
    if (rows[0].state !== 'disputed') throw new EscrowError('not_disputed', 409);
    const { rows: open } = await client.query(
      `SELECT 1 FROM broadcasts WHERE contract_id = $1 AND status <> 'proposed' LIMIT 1`, [id]);
    if (open[0]) throw new EscrowError('signing_in_progress', 409);
    const resolution = parsed.data.winner === 'buyer' ? 'released_to_buyer' : 'refunded_to_funder';
    await client.query(`DELETE FROM broadcasts WHERE contract_id = $1 AND status = 'proposed'`, [id]);
    await client.query(
      `UPDATE contracts SET resolution = $1, resolved_by = $2, resolution_reason = $3 WHERE id = $4`,
      [resolution, req.user!.id, parsed.data.reason, id]);
    await client.query('COMMIT');
    return res.json({ status: 'decided', resolution });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof EscrowError) return res.status(err.status).json({ error: err.code });
    throw err;
  } finally { client.release(); }
});

function purposeFor(c: { state: string; resolution: string | null; stranded_detected_at: string | null }): Purpose | null {
  if (c.state === 'cancelled' && c.stranded_detected_at) return 'refund';
  if (c.state === 'disputed' && c.resolution === 'released_to_buyer') return 'release';
  if (c.state === 'disputed' && c.resolution === 'refunded_to_funder') return 'refund';
  return null;
}

// Spec §8.1 step 2 - the unsigned side, plus a plain summary of every
// output so the Owner can compare it with the Ledger screen (§8.2).
// The winning party signs the same PSBT from their trade page.
adminRouter.get('/admin/escrow/contracts/:id/arbitration-proposal', requireSession, requireOwner, async (req, res) => {
  const id = idParam(req);
  const { rows } = await pool.query('SELECT chain, state, resolution, stranded_detected_at FROM contracts WHERE id = $1', [id]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'not_found' });
  const purpose = purposeFor(c);
  if (!purpose) return res.status(409).json({ error: 'not_decided_yet' });
  try {
    const proposal = await getOrCreateProposal(id, purpose, 'platform');
    const psbt = bitcoin.Psbt.fromBase64(proposal.psbt, { network: networkFor(c.chain as UtxoChain) });
    res.json({
      contractId: id, purpose, winner: purpose === 'release' ? 'buyer' : 'funder',
      psbtBase64: proposal.psbt, status: proposal.status, first_signer: proposal.first_signer,
      network_fee: proposal.network_fee,
      outputs: psbt.txOutputs.map((o) => ({ address: o.address ?? null, value: String(o.value) })),
    });
  } catch (err) {
    if (err instanceof EscrowError) return res.status(err.status).json({ error: err.code });
    throw err;
  }
});

// Spec §8.1 steps 5-6 - the Owner's hardware-signed PSBT comes back from
// the admin browser and is combined with the winner's signature.
adminRouter.post(
  '/admin/escrow/contracts/:id/resolve',
  requireSession,
  requireOwner,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyFn: (req) => `admin_resolve:${req.user!.id}` }),
  async (req, res) => {
    const id = idParam(req);
    const parsed = z.object({ signed_psbt_base64: z.string().min(1).max(200_000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    const { rows } = await pool.query('SELECT state, resolution, stranded_detected_at FROM contracts WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    const purpose = purposeFor(rows[0]);
    if (!purpose) return res.status(409).json({ error: 'not_decided_yet' });
    try {
      res.json(await submitSignature({
        contractId: id, purpose, signer: 'platform', signedPsbtBase64: parsed.data.signed_psbt_base64, actorUserId: req.user!.id,
      }));
    } catch (err) {
      if (err instanceof EscrowError) return res.status(err.status).json({ error: err.code });
      throw err;
    }
  }
);
