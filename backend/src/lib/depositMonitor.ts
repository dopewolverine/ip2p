import { pool } from '../db/pool';
import { getAdapter } from '../chain';
import { confirmationsRequired } from './confirmationThresholds';
import { sendEmail } from './email';
import { logWalletEvent } from './walletEvents';
import { emitNotificationStandalone } from './notifications';
import type { Asset, Chain, ChainTx, Subscription } from '../chain/types';

// Spec P1 §6.1 - subscribe to every active address, record inbound
// transactions as pending, track confirmations until the threshold is
// met, then mark confirmed. Two moving parts:
//
//  1. subscribeWallet() - one push subscription per wallet, via the
//     chain adapter. Fires once when a new inbound tx is first seen.
//  2. startConfirmationSweep() - a periodic poll over 'pending' rows,
//     since a subscription firing once doesn't track confirmations
//     rising afterward; each chain adapter is asked directly.
//
// KNOWN LIMITATION: each subscribeWallet() call opens its own connection
// (one WebSocket per Bitcoin/Litecoin address, one filter per Ethereum
// address/token pair, one poll timer for Tron). Blockbook's protocol
// actually supports subscribing many addresses over a single connection -
// consolidating to that is a reasonable next step once wallet counts
// make per-address connections a real resource problem, but it would
// mean changing the ChainAdapter.subscribeAddress signature, which
// ripples into every adapter. Left as one-per-address for now, deliberately.

const activeSubscriptions = new Map<string, Subscription>(); // keyed by wallet id

interface MonitoredWallet {
  id: string;
  user_id: string;
  asset: string;
  chain: Chain;
  address: string;
}

async function notifyDeposit(userId: string, asset: string, tx: ChainTx, phase: 'pending' | 'confirmed') {
  const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
  const email = rows[0]?.email;
  if (!email) return;

  const subject = phase === 'pending'
    ? `Deposit detected — ${asset}`
    : `Deposit confirmed — ${asset}`;
  const body = phase === 'pending'
    ? `A ${asset} deposit was just detected on one of your addresses.\n\nTxid: ${tx.txid}\n\nIt's pending confirmation — we'll email again once it clears.`
    : `Your ${asset} deposit has reached the confirmation threshold and is now spendable.\n\nTxid: ${tx.txid}`;

  await sendEmail(email, subject, body);
}

async function recordDeposit(wallet: MonitoredWallet, tx: ChainTx) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO transactions (user_id, wallet_id, direction, txid, amount, confirmations, status)
       VALUES ($1, $2, 'in', $3, $4, $5, 'pending')
       ON CONFLICT (txid, wallet_id, direction) DO NOTHING
       RETURNING id`,
      [wallet.user_id, wallet.id, tx.txid, tx.amount, tx.confirmations]
    );
    // Only a genuinely new row notifies. Adapters replay recent
    // transactions after a restart, which re-sent "deposit detected" emails.
    if (!rows[0]) return;
    await logWalletEvent({ userId: wallet.user_id, eventType: 'deposit_detected', asset: wallet.asset, metadata: { txid: tx.txid } });
    await notifyDeposit(wallet.user_id, wallet.asset, tx, 'pending');
  } catch (err) {
    console.error('recordDeposit failed', err);
  }
}

export function subscribeWallet(wallet: MonitoredWallet): void {
  if (activeSubscriptions.has(wallet.id)) return; // already watching

  try {
    const adapter = getAdapter(wallet.chain);
    const sub = adapter.subscribeAddress(wallet.address, (tx) => {
      if (tx.direction === 'in') void recordDeposit(wallet, tx);
    }, { asset: wallet.asset as Asset });
    activeSubscriptions.set(wallet.id, sub);
  } catch (err) {
    // Most likely NOWNODES_API_KEY isn't set - don't crash the request
    // that triggered this (e.g. POST /wallet/addresses); just don't monitor.
    console.error(`could not subscribe wallet ${wallet.id} (${wallet.asset})`, err);
  }
}

export async function startDepositMonitor(): Promise<void> {
  // Spec P1 §6.3 / acceptance criterion 16 - addresses belonging to
  // archived wallets stay in the monitoring set forever (a password
  // reset doesn't stop watching an old address for incoming funds). No
  // status filter here on purpose - active AND archived both get
  // re-subscribed on every restart.
  const { rows } = await pool.query<MonitoredWallet>(
    `SELECT id, user_id, asset, chain, address FROM wallets`
  );
  for (const wallet of rows) {
    subscribeWallet(wallet as unknown as MonitoredWallet);
  }
}

// Spec P1 §6.1 step 3/4 - track confirmations until threshold, then mark
// confirmed. Runs independently of the push subscriptions above.
export function startConfirmationSweep(): void {
  setInterval(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT t.id, t.txid, t.user_id, t.amount, t.confirmations, t.direction, w.asset, w.chain
         FROM transactions t
         JOIN wallets w ON w.id = t.wallet_id
         WHERE t.status = 'pending'`
      );

      for (const row of rows) {
        try {
          const confirmations = await getAdapter(row.chain as Chain).getConfirmations(row.txid);
          const required = confirmationsRequired(row.chain as Chain, row.amount);

          if (confirmations >= required) {
            await pool.query(
              `UPDATE transactions SET status = 'confirmed', confirmations = $1, confirmed_at = now() WHERE id = $2`,
              [confirmations, row.id]
            );

            if (row.direction === 'in') {
              await logWalletEvent({ userId: row.user_id, eventType: 'deposit_confirmed', asset: row.asset, metadata: { txid: row.txid } });
              await notifyDeposit(row.user_id, row.asset, {
                txid: row.txid, direction: 'in', amount: row.amount, confirmations, timestamp: 0,
              }, 'confirmed');
            }

            // Spec P4 §4.2 - deposit_confirmed is 'normal' priority,
            // withdrawal_confirmed is 'low'. Routed through the proper
            // outbox (web/Telegram/email per priority, respecting
            // preferences) rather than the direct email notifyDeposit()
            // already sends for deposits - both fire for deposits (the
            // outbox is the source of truth for the bell icon and
            // Telegram; notifyDeposit's direct email is the pre-P4
            // mechanism, left in place rather than removed mid-session).
            await emitNotificationStandalone({
              userId: row.user_id,
              type: row.direction === 'in' ? 'deposit_confirmed' : 'withdrawal_confirmed',
              priority: row.direction === 'in' ? 'normal' : 'low',
              payload: { asset: row.asset, txid: row.txid },
              dedupeKey: row.id, // one per transaction row, not one ever per user
            });
          } else if (confirmations !== row.confirmations) {
            await pool.query(`UPDATE transactions SET confirmations = $1 WHERE id = $2`, [confirmations, row.id]);
          }
        } catch (err) {
          console.error(`confirmation check failed for tx ${row.txid}`, err);
        }
      }
    } catch (err) {
      console.error('confirmation sweep failed', err);
    }
  }, 60_000).unref();
}
