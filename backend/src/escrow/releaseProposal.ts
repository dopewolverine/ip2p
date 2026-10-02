import * as bitcoin from 'bitcoinjs-lib';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { getAdapter } from '../chain';
import type { BitcoinAdapter } from '../chain/bitcoinAdapter';
import { networkFor, UtxoChain } from '../chain/networks';
import { escrowConfig } from './config';
import {
  buildProposalPsbt, EscrowUtxo, MAX_PROPOSAL_RATE, MIN_RELAY_RATE, unsignedTxHex, signatureValidator,
} from './releaseTx';
import { applyTransition } from './applyTransition';
import type { TransitionTrigger } from './stateMachine';
import { emitNotification } from '../lib/notifications';
import { confirmationsRequired } from '../lib/confirmationThresholds';

export type Purpose = 'release' | 'refund';
export type Signer = 'vendor' | 'customer' | 'platform';

export class EscrowError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

interface LoadedContract {
  id: string; reference: string; chain: UtxoChain; state: string; crypto_side: 'vendor' | 'customer';
  vendor_id: string; customer_id: string; amount: string; fee_amount: string; network_reserve: string;
  escrow_address: string; redeem_script: string; funding_txid: string | null; funding_vout: number | null;
  resolution: string | null; resolution_reason: string | null; stranded_detected_at: string | null;
  keys: Partial<Record<Signer, string>>; payouts: Partial<Record<'vendor' | 'customer', string>>;
}

async function loadContract(db: PoolClient | typeof pool, contractId: string, lock = false): Promise<LoadedContract> {
  const { rows } = await db.query(`SELECT * FROM contracts WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [contractId]);
  const c = rows[0];
  if (!c) throw new EscrowError('not_found', 404);
  if (c.chain !== 'bitcoin' && c.chain !== 'litecoin') throw new EscrowError('not_a_multisig_chain');
  if (!c.escrow_address || !c.redeem_script) throw new EscrowError('no_escrow_address', 409);
  const { rows: keyRows } = await db.query(
    'SELECT party, public_key, payout_address FROM contract_keys WHERE contract_id = $1', [contractId]
  );
  const keys: LoadedContract['keys'] = {};
  const payouts: LoadedContract['payouts'] = {};
  for (const k of keyRows) {
    keys[k.party as Signer] = k.public_key;
    if ((k.party === 'vendor' || k.party === 'customer') && k.payout_address) payouts[k.party as 'vendor' | 'customer'] = k.payout_address;
  }
  return { ...c, keys, payouts };
}

// Who must sign which purpose, in which state, and what finalising does.
export function purposeRules(c: Pick<LoadedContract, 'state' | 'crypto_side' | 'resolution' | 'stranded_detected_at'>, purpose: Purpose):
  { signers: Signer[]; chargeFee: boolean; trigger: TransitionTrigger | null } {
  const funder = c.crypto_side;
  const buyer = funder === 'vendor' ? 'customer' : 'vendor';
  if (c.state === 'paid' && purpose === 'release') {
    return { signers: ['vendor', 'customer'], chargeFee: true, trigger: 'release_broadcast' };
  }
  if ((c.state === 'funded' || c.state === 'paid') && purpose === 'refund') {
    return { signers: ['vendor', 'customer'], chargeFee: false, trigger: 'mutual_refund_broadcast' }; // §8A: no fee
  }
  if (c.state === 'disputed' && c.resolution === 'released_to_buyer' && purpose === 'release') {
    return { signers: [buyer, 'platform'], chargeFee: true, trigger: 'owner_resolves_to_buyer' };
  }
  if (c.state === 'disputed' && c.resolution === 'refunded_to_funder' && purpose === 'refund') {
    return { signers: [funder, 'platform'], chargeFee: true, trigger: 'owner_resolves_to_funder' }; // §8A: charged either way
  }
  if (c.state === 'cancelled' && purpose === 'refund' && c.stranded_detected_at) {
    return { signers: ['vendor', 'customer', 'platform'], chargeFee: false, trigger: null };
  }
  throw new EscrowError('purpose_not_allowed_in_state', 409);
}

async function escrowUtxos(c: LoadedContract): Promise<EscrowUtxo[]> {
  const adapter = getAdapter(c.chain) as BitcoinAdapter;
  const confirmed = (await adapter.getUtxos(c.escrow_address)).filter((u) => u.confirmations >= 1);
  if (c.state !== 'cancelled' && c.funding_txid) {
    const present = confirmed.some((u) => u.txid === c.funding_txid && u.vout === Number(c.funding_vout));
    if (!present) throw new EscrowError('funding_output_missing', 409);
  }
  if (confirmed.length === 0) throw new EscrowError('no_confirmed_funds', 409);
  // Every confirmed output at the escrow address is spent, so an accidental
  // second deposit is returned to the funder instead of being stranded.
  return Promise.all(confirmed.map(async (u) => ({
    txid: u.txid, vout: u.vout, value: BigInt(u.value), rawTxHex: await adapter.getRawTransactionHex(u.txid),
  })));
}

function presentRow(row: any) {
  return {
    purpose: row.purpose, status: row.status, psbt: row.psbt, first_signer: row.first_signer,
    fee_rate: row.fee_rate === null ? null : String(row.fee_rate),
    network_fee: row.network_fee === null ? null : String(row.network_fee),
    txid: row.txid ?? null, created_at: row.created_at,
  };
}

export async function getProposal(contractId: string, purpose: Purpose) {
  const { rows } = await pool.query('SELECT * FROM broadcasts WHERE contract_id = $1 AND purpose = $2', [contractId, purpose]);
  return rows[0] ? presentRow(rows[0]) : null;
}

export async function getOrCreateProposal(contractId: string, purpose: Purpose, requester: Signer) {
  const c = await loadContract(pool, contractId);
  const rules = purposeRules(c, purpose);
  if (!rules.signers.includes(requester)) throw new EscrowError('not_a_signer_for_this_purpose', 403);

  const pending = await pool.query(`SELECT 1 FROM broadcasts WHERE contract_id = $1 AND status IN ('signed', 'broadcast', 'confirmed')`, [contractId]);
  if (pending.rows[0]) throw new EscrowError('settlement_pending', 409);
  const existing = await getProposal(contractId, purpose);
  if (existing) {
    if (existing.status === 'proposed' || existing.status === 'partially_signed') return existing;
    throw new EscrowError('already_finalized', 409);
  }

  const funder = c.crypto_side;
  const buyer = funder === 'vendor' ? 'customer' : 'vendor';
  const buyerAddress = c.payouts[buyer];
  const funderAddress = c.payouts[funder];
  if (!buyerAddress || !funderAddress) throw new EscrowError('payout_address_missing', 409);

  const feeAmount = rules.chargeFee ? BigInt(c.fee_amount) : 0n;
  const feeAddress = feeAmount > 0n ? escrowConfig.platformFeeAddress[c.chain] : null;

  const adapter = getAdapter(c.chain) as BitcoinAdapter;
  let rate: bigint;
  try {
    rate = BigInt((await adapter.estimateFee(c.chain === 'bitcoin' ? 'BTC' : 'LTC', 'normal')).normal);
  } catch {
    rate = MIN_RELAY_RATE[c.chain] * 5n;
  }
  if (rate < MIN_RELAY_RATE[c.chain]) rate = MIN_RELAY_RATE[c.chain];
  if (rate > MAX_PROPOSAL_RATE[c.chain]) rate = MAX_PROPOSAL_RATE[c.chain];

  let built;
  try {
    built = buildProposalPsbt({
      chain: c.chain, purpose, witnessScriptHex: c.redeem_script, utxos: await escrowUtxos(c),
      amount: BigInt(c.amount), feeAmount, buyerAddress, funderAddress, feeAddress, feeRate: rate,
    });
  } catch (err) {
    if (err instanceof EscrowError) throw err;
    throw new EscrowError((err as Error).message, 409);
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await loadContract(db, contractId, true);
    if (current.state !== c.state || current.resolution !== c.resolution) throw new EscrowError('trade_changed_retry', 409);
    const currentRules = purposeRules(current, purpose);
    if (!currentRules.signers.includes(requester)) throw new EscrowError('not_a_signer_for_this_purpose', 403);
    const pending = await db.query(`SELECT 1 FROM broadcasts WHERE contract_id = $1 AND status IN ('signed', 'broadcast', 'confirmed')`, [contractId]);
    if (pending.rows[0]) throw new EscrowError('settlement_pending', 409);
    await db.query(
      `INSERT INTO broadcasts (contract_id, purpose, raw_tx, status, idempotency_key, psbt, fee_rate, network_fee)
       VALUES ($1, $2, NULL, 'proposed', $3, $4, $5, $6)
       ON CONFLICT (contract_id, purpose) DO NOTHING`,
      [contractId, purpose, `${contractId}:${purpose}`, built.psbtBase64, rate.toString(), built.networkFee.toString()]);
    const proposal = await db.query('SELECT * FROM broadcasts WHERE contract_id = $1 AND purpose = $2', [contractId, purpose]);
    await db.query('COMMIT');
    return presentRow(proposal.rows[0]);
  } catch (err) { await db.query('ROLLBACK'); throw err; }
  finally { db.release(); }
}

// A proposal can be withdrawn before it is final: unsigned by any signer;
// half-signed only by whoever signed it (or the Owner).
export async function discardProposal(contractId: string, purpose: Purpose, requester: Signer): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await loadContract(db, contractId, true);
    const { rows } = await db.query('SELECT id, status, first_signer FROM broadcasts WHERE contract_id = $1 AND purpose = $2 FOR UPDATE', [contractId, purpose]);
    const row = rows[0];
    if (!row) throw new EscrowError('not_found', 404);
    if (!(row.status === 'proposed' || (row.status === 'partially_signed' && (row.first_signer === requester || requester === 'platform')))) throw new EscrowError('cannot_discard', 409);
    await db.query('DELETE FROM broadcasts WHERE id = $1', [row.id]);
    await db.query('COMMIT');
  } catch (err) { await db.query('ROLLBACK'); throw err; }
  finally { db.release(); }
}

export async function submitSignature(params: {
  contractId: string; purpose: Purpose; signer: Signer; signedPsbtBase64: string; actorUserId: string;
}): Promise<{ status: 'awaiting_counterparty' | 'broadcast' | 'signed'; txid?: string }> {
  const client = await pool.connect();
  let finalized: { rawTx: string; txid: string; chain: UtxoChain } | null = null;
  try {
    await client.query('BEGIN');
    // State check inside the same transaction as the write (§9).
    const c = await loadContract(client, params.contractId, true);
    const rules = purposeRules(c, params.purpose);
    const otherSettlement = await client.query(`SELECT 1 FROM broadcasts WHERE contract_id = $1 AND status IN ('signed', 'broadcast', 'confirmed')`, [params.contractId]);
    if (otherSettlement.rows[0]) throw new EscrowError('settlement_pending', 409);
    if (!rules.signers.includes(params.signer)) throw new EscrowError('not_a_signer_for_this_purpose', 403);

    const { rows } = await client.query(
      'SELECT * FROM broadcasts WHERE contract_id = $1 AND purpose = $2 FOR UPDATE',
      [params.contractId, params.purpose]
    );
    const row = rows[0];
    if (!row || !['proposed', 'partially_signed'].includes(row.status) || !row.psbt) throw new EscrowError('no_open_proposal', 409);

    const network = networkFor(c.chain);
    const stored = bitcoin.Psbt.fromBase64(row.psbt, { network });
    let incoming: bitcoin.Psbt;
    try {
      incoming = bitcoin.Psbt.fromBase64(params.signedPsbtBase64, { network });
    } catch {
      throw new EscrowError('invalid_psbt');
    }
    // The signer must have signed exactly the stored transaction.
    if (unsignedTxHex(stored) !== unsignedTxHex(incoming)) throw new EscrowError('psbt_mismatch');

    const signerKeyHex = c.keys[params.signer];
    if (!signerKeyHex) throw new EscrowError('signer_key_missing', 409);
    const signerKey = Buffer.from(signerKeyHex, 'hex');

    for (let i = 0; i < stored.inputCount; i++) {
      const mine = (incoming.data.inputs[i]?.partialSig ?? []).find((s) => s.pubkey.equals(signerKey));
      if (!mine) throw new EscrowError('signature_missing');
      // §4A.2 - server rejects anything but SIGHASH_ALL before combining.
      if (mine.signature[mine.signature.length - 1] !== bitcoin.Transaction.SIGHASH_ALL) {
        throw new EscrowError('non_sighash_all_signature');
      }
      if (!incoming.validateSignaturesOfInput(i, signatureValidator, signerKey)) throw new EscrowError('invalid_signature');
      if ((stored.data.inputs[i]?.partialSig ?? []).some((s) => s.pubkey.equals(signerKey))) throw new EscrowError('already_signed', 409);
      stored.updateInput(i, { partialSig: [mine] });
    }

    const signedCount = (stored.data.inputs[0]?.partialSig ?? []).length;
    if (signedCount >= 2) {
      if (!stored.validateSignaturesOfAllInputs(signatureValidator)) throw new EscrowError('invalid_signature');
      stored.finalizeAllInputs();
      const tx = stored.extractTransaction();
      const rawTx = tx.toHex();
      const txid = tx.getId();
      // §10 - recorded BEFORE it is sent, so a crash mid-broadcast is
      // reconciled (re-broadcast of the same transaction), never repaid.
      await client.query(
        `UPDATE broadcasts SET status = 'signed', raw_tx = $1, txid = $2, psbt = NULL, updated_at = now() WHERE id = $3`,
        [rawTx, txid, row.id]
      );
      await client.query('UPDATE contracts SET release_txid = $1 WHERE id = $2', [txid, params.contractId]);
      await client.query(
        `UPDATE broadcasts SET final_trigger = $1, final_actor_id = $2, final_actor_type = $3, final_reason = $4 WHERE id = $5`,
        [rules.trigger, params.actorUserId, params.signer === 'platform' ? 'admin' : 'user',
         rules.trigger?.startsWith('owner_') ? c.resolution_reason : null, row.id]);
      await client.query('COMMIT');
      finalized = { rawTx, txid, chain: c.chain };
    } else {
      await client.query(
        `UPDATE broadcasts SET psbt = $1, status = 'partially_signed', first_signer = $2, updated_at = now() WHERE id = $3`,
        [stored.toBase64(), params.signer, row.id]
      );
      for (const s of rules.signers) {
        if (s === params.signer || s === 'platform') continue;
        await emitNotification(client, {
          userId: s === 'vendor' ? c.vendor_id : c.customer_id, type: 'escrow_signature_requested', priority: 'critical',
          contractId: params.contractId, payload: { reference: c.reference, purpose: params.purpose }, dedupeKey: params.purpose,
        });
      }
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (!finalized) return { status: 'awaiting_counterparty' };
  const sent = await tryBroadcast(params.contractId, params.purpose, finalized.chain, finalized.rawTx);
  return { status: sent ? 'broadcast' : 'signed', txid: finalized.txid };
}

// A network error is not evidence of acceptance. Reconcile by exact txid.
export async function tryBroadcast(contractId: string, purpose: Purpose, chain: UtxoChain, rawTx: string): Promise<boolean> {
  const txid = bitcoin.Transaction.fromHex(rawTx).getId();
  try {
    const result = await (getAdapter(chain) as BitcoinAdapter).broadcast(rawTx);
    if (result.txid !== txid) throw new Error('provider_returned_different_txid');
  } catch {
    // Do not classify arbitrary provider messages containing "known" as success.
    // A subsequent lookup must return precisely this transaction.
    try {
      const known = await (getAdapter(chain) as BitcoinAdapter).getRawTransactionHex(txid);
      if (bitcoin.Transaction.fromHex(known).getId() !== txid) throw new Error('txid_mismatch');
    } catch {
      await pool.query(`UPDATE broadcasts SET attempts = attempts + 1, last_error = 'broadcast_unverified', updated_at = now()
        WHERE contract_id = $1 AND purpose = $2 AND status = 'signed'`, [contractId, purpose]);
      return false;
    }
  }
  await pool.query(`UPDATE broadcasts SET status = 'broadcast', attempts = attempts + 1, last_error = NULL, updated_at = now()
    WHERE contract_id = $1 AND purpose = $2 AND status = 'signed'`, [contractId, purpose]);
  return true;
}

export async function reconcileSettlement(contractId: string, purpose: Purpose): Promise<void> {
  const { rows } = await pool.query(`SELECT b.*, c.chain, c.amount FROM broadcasts b
    JOIN contracts c ON c.id = b.contract_id WHERE b.contract_id = $1 AND b.purpose = $2`, [contractId, purpose]);
  const row = rows[0];
  if (!row || !row.raw_tx || !['signed', 'broadcast'].includes(row.status)) return;
  const expected = bitcoin.Transaction.fromHex(row.raw_tx).getId();
  if (expected !== row.txid) throw new Error('stored_settlement_txid_mismatch');
  if (row.status === 'signed' && !(await tryBroadcast(contractId, purpose, row.chain, row.raw_tx))) return;
  const depth = await getAdapter(row.chain).getConfirmations(row.txid);
  if (depth < confirmationsRequired(row.chain, row.amount)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM contracts WHERE id = $1 FOR UPDATE', [contractId]);
    const current = await client.query('SELECT status FROM broadcasts WHERE id = $1 FOR UPDATE', [row.id]);
    if (current.rows[0]?.status === 'confirmed') { await client.query('COMMIT'); return; }
    if (row.final_trigger) {
      await applyTransition({ contractId, trigger: row.final_trigger, actorType: row.final_actor_type,
        actorId: row.final_actor_id, reason: row.final_reason,
        idempotencyKey: `${contractId}:${purpose}:confirmed`, settlementConfirmed: true }, client);
    }
    await client.query(`UPDATE broadcasts SET status = 'confirmed', confirmed_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`, [row.id]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export function startBroadcastReconciler(): void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const { rows } = await pool.query(`SELECT contract_id, purpose FROM broadcasts WHERE status IN ('signed', 'broadcast') AND raw_tx IS NOT NULL`);
      for (const r of rows) {
        try { await reconcileSettlement(r.contract_id, r.purpose); }
        catch { console.error('settlement_reconciliation_failed', r.contract_id); }
      }
    } finally { running = false; }
  };
  setInterval(() => { void sweep().catch(() => console.error('settlement_sweep_failed')); }, 30_000).unref();
  void sweep().catch(() => console.error('settlement_startup_failed'));
}
