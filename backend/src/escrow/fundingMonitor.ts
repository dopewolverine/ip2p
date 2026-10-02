import { pool } from '../db/pool';
import { getAdapter } from '../chain';
import type { BitcoinAdapter } from '../chain/bitcoinAdapter';
import { confirmationsRequired } from '../lib/confirmationThresholds';
import { emitNotificationStandalone } from '../lib/notifications';
import { applyTransition } from './applyTransition';
import { notifyStaff } from './alerts';
import type { Chain, Subscription } from '../chain/types';

// Spec P2 §4.2 - funding detection.
//
// The websocket is only a trigger. Funding state always comes from the
// escrow address's UTXO set, read on every trigger and by a periodic
// sweep, so payments that arrive while the server is down are not missed.
//
// Rules (§4.2): one output of at least amount + fee + network reserve;
// never `funded` on a mempool sighting - a sighting only freezes the
// accepted-state timer; confirmations per P1 §6.2.

const watched = new Map<string, Subscription>();
const inFlight = new Set<string>();
const SWEEP_MS = Number(process.env.ESCROW_SWEEP_MS ?? 60_000);

export function watchEscrowAddress(target: { contractId: string; chain: Chain; escrowAddress: string }): void {
  if (watched.has(target.contractId)) return;
  try {
    const sub = getAdapter(target.chain).subscribeAddress(target.escrowAddress, () => {
      void checkContractFunding(target.contractId);
    });
    watched.set(target.contractId, sub);
  } catch (err) {
    console.error(`could not watch escrow address for contract ${target.contractId}`, (err as Error).message);
  }
}

export async function checkContractFunding(contractId: string): Promise<void> {
  if (inFlight.has(contractId)) return;
  inFlight.add(contractId);
  try {
    const { rows } = await pool.query(
      `SELECT id, reference, chain, state, escrow_address, amount, fee_amount, network_reserve,
              funding_txid, crypto_side, vendor_id, customer_id
       FROM contracts WHERE id = $1`,
      [contractId]
    );
    const c = rows[0];
    if (!c || c.state !== 'accepted' || !c.escrow_address) return;
    if (c.chain !== 'bitcoin' && c.chain !== 'litecoin') return;

    const required = BigInt(c.amount) + BigInt(c.fee_amount) + BigInt(c.network_reserve);
    const adapter = getAdapter(c.chain) as BitcoinAdapter;
    const utxos = await adapter.getUtxos(c.escrow_address);
    const sufficient = utxos
      .filter((u) => BigInt(u.value) >= required)
      .sort((a, b) => b.confirmations - a.confirmations);
    const best = sufficient[0];
    const funderId = c.crypto_side === 'vendor' ? c.vendor_id : c.customer_id;

    if (!best) {
      if (utxos.length > 0) {
        // Underfunding does not advance state (§4.2). Tell the funder once.
        const received = utxos.reduce((s, u) => s + BigInt(u.value), 0n);
        await emitNotificationStandalone({
          userId: funderId, type: 'escrow_underfunded', priority: 'critical', contractId,
          payload: { reference: c.reference, received: received.toString(), required: required.toString() },
        });
      }
      // A mempool sighting that disappeared (replaced/dropped) must not
      // freeze the timer forever.
      if (c.funding_txid) {
        await pool.query(`UPDATE contracts SET funding_txid = NULL, funding_vout = NULL WHERE id = $1 AND state = 'accepted'`, [contractId]);
      }
      return;
    }

    const needed = confirmationsRequired(c.chain, String(c.amount));
    if (best.confirmations < needed) {
      if (c.funding_txid !== best.txid) {
        await pool.query(
          `UPDATE contracts SET funding_txid = $1, funding_vout = $2 WHERE id = $3 AND state = 'accepted'`,
          [best.txid, best.vout, contractId]
        );
      }
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE contracts SET funding_txid = $1, funding_vout = $2, funded_at = now() WHERE id = $3`,
        [best.txid, best.vout, contractId]
      );
      await applyTransition({
        contractId, trigger: 'funding_confirmed', actorType: 'system', actorId: null,
        reason: BigInt(best.value) > required ? `overfunded: received ${best.value}, required ${required}` : null,
        idempotencyKey: `funding_confirmed:${contractId}`,
      }, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(`funding check failed for contract ${contractId}: ${(err as Error).message}`);
  } finally {
    inFlight.delete(contractId);
  }
}

// Coins that reach the escrow address of a cancelled trade (late or split
// funding) are detected and flagged. Either party, or the Owner with the
// Ledger, can then sign a refund to the funder from the trade page.
// P2 Rule 1 still holds: two of the three keys are required.
async function checkStrandedFunds(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, reference, chain, escrow_address, vendor_id, customer_id
     FROM contracts
     WHERE state = 'cancelled' AND escrow_address IS NOT NULL AND stranded_detected_at IS NULL
       AND chain IN ('bitcoin', 'litecoin') AND closed_at > now() - interval '30 days'`
  );
  for (const c of rows) {
    try {
      const utxos = (await (getAdapter(c.chain) as BitcoinAdapter).getUtxos(c.escrow_address)).filter((u) => u.confirmations >= 1);
      if (utxos.length === 0) continue;
      await pool.query(`UPDATE contracts SET stranded_detected_at = now() WHERE id = $1`, [c.id]);
      for (const userId of [c.vendor_id, c.customer_id]) {
        await emitNotificationStandalone({
          userId, type: 'escrow_stranded_funds', priority: 'critical', contractId: c.id, payload: { reference: c.reference },
        });
      }
      await notifyStaff('escrow_stranded_funds', c.id, { reference: c.reference });
    } catch (err) {
      console.error(`stranded-funds check failed for contract ${c.id}: ${(err as Error).message}`);
    }
  }
}

export async function startEscrowFundingMonitor(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, chain, escrow_address FROM contracts
     WHERE state = 'accepted' AND escrow_address IS NOT NULL AND chain IN ('bitcoin', 'litecoin')`
  );
  for (const row of rows) watchEscrowAddress({ contractId: row.id, chain: row.chain, escrowAddress: row.escrow_address });
}

export function startEscrowFundingSweep(): void {
  let tick = 0;
  setInterval(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM contracts WHERE state = 'accepted' AND escrow_address IS NOT NULL AND chain IN ('bitcoin', 'litecoin')`
      );
      for (const r of rows) await checkContractFunding(r.id);
      if (tick++ % 10 === 0) await checkStrandedFunds();
    } catch (err) {
      console.error('escrow funding sweep failed', err);
    }
  }, SWEEP_MS).unref();
}
