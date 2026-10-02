import { pool } from '../db/pool';
import { applyTransition } from './applyTransition';
import { sendEmail } from '../lib/email';
import { emitNotificationStandalone } from '../lib/notifications';

// Spec §7 - a worker running every 60 seconds. Spec §6.2's "rule that
// governs everything" constrains what this worker is even allowed to
// do: past `funded`, it may only notify or move a contract to
// `disputed` - never release, never refund, never anything that
// broadcasts. Every call below uses only cancel_timer or dispute_timer
// (see stateMachine.ts's TIMER_ALLOWED_TRIGGERS), which is what makes
// that true structurally rather than by convention.

const WORKER_NAME = 'escrow_timers';
const TICK_MS = 60_000;
const OUTAGE_THRESHOLD_MS = TICK_MS * 1.5; // allow normal jitter; anything beyond this is a real gap

async function notifyParties(contractId: string, subject: string, body: string) {
  const { rows } = await pool.query(
    `SELECT u.email FROM contracts c
     JOIN users u ON u.id IN (c.vendor_id, c.customer_id)
     WHERE c.id = $1 AND u.email IS NOT NULL`,
    [contractId]
  );
  for (const row of rows) {
    await sendEmail(row.email, subject, body);
  }
}

// Spec §7.1 - "downtime pauses timers. On restart, extend every active
// window by the outage duration and email both parties on affected
// trades. Log the outage window so the adjustment is auditable in a
// later dispute." The gap between two consecutive heartbeat ticks IS
// the outage duration - a clean shutdown ticks normally right up until
// the process stops, so only a genuine gap (crash, deploy, host
// downtime) produces a jump bigger than OUTAGE_THRESHOLD_MS.
async function checkForOutageAndExtend(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT last_tick_at FROM worker_heartbeat WHERE worker_name = $1`,
    [WORKER_NAME]
  );
  const now = new Date();

  if (rows[0]) {
    const gapMs = now.getTime() - new Date(rows[0].last_tick_at).getTime();
    if (gapMs > OUTAGE_THRESHOLD_MS) {
      const outageSeconds = Math.round(gapMs / 1000);
      const outageStartedAt = new Date(rows[0].last_tick_at);

      const { rows: affected } = await pool.query(
        `UPDATE contracts
         SET timer_extension_seconds = timer_extension_seconds + $1
         WHERE state IN ('requested', 'accepted', 'funded', 'paid')
         RETURNING id`,
        [outageSeconds]
      );

      await pool.query(
        `INSERT INTO timer_outage_adjustments
           (worker_name, outage_started_at, outage_detected_at, outage_seconds, contracts_affected)
         VALUES ($1, $2, $3, $4, $5)`,
        [WORKER_NAME, outageStartedAt, now, outageSeconds, affected.length]
      );

      for (const row of affected) {
        await notifyParties(
          row.id,
          'Trade window extended due to platform downtime',
          `Trade ${row.id}'s payment window was extended by ${outageSeconds} seconds to account for platform downtime. This does not affect your trade otherwise.`
        );
      }
    }
  }

  await pool.query(
    `INSERT INTO worker_heartbeat (worker_name, last_tick_at) VALUES ($1, $2)
     ON CONFLICT (worker_name) DO UPDATE SET last_tick_at = EXCLUDED.last_tick_at`,
    [WORKER_NAME, now]
  );
}

async function processRequestedAndAccepted() {
  for (const state of ['requested', 'accepted'] as const) {
    const { rows } = await pool.query(
      `SELECT id, funding_txid, created_at, accepted_at, timer_extension_seconds FROM contracts WHERE state = $1`,
      [state]
    );
    for (const row of rows) {
      // Spec §7.1 - mempool freezes the `accepted` timer; a funder who
      // broadcasts at minute 29 must not lose a valid trade to chain speed.
      if (state === 'accepted' && row.funding_txid) continue;

      const since = state === 'requested' ? row.created_at : row.accepted_at;
      const windowMs = 30 * 60 * 1000 + row.timer_extension_seconds * 1000;
      const elapsedMs = Date.now() - new Date(since).getTime();
      if (elapsedMs < windowMs) continue;

      try {
        await applyTransition({
          contractId: row.id,
          trigger: 'cancel_timer',
          actorType: 'system',
          actorId: null,
          reason: `${state} window (30 min) expired`,
          idempotencyKey: `cancel_timer:${row.id}:${state}`,
        });
        // Notification already handled inside applyTransition (spec §4.3 -
        // committed in the same transaction as the state change itself).
      } catch (err) {
        console.error(`cancel_timer failed for contract ${row.id}`, err);
      }
    }
  }
}

async function processFundedAndPaid() {
  const { rows: fundedRows } = await pool.query(
    `SELECT id, funded_at, payment_window_hours, timer_extension_seconds FROM contracts WHERE state = 'funded'`
  );
  for (const row of fundedRows) {
    const windowMs = row.payment_window_hours * 60 * 60 * 1000 + row.timer_extension_seconds * 1000;
    const elapsedMs = Date.now() - new Date(row.funded_at).getTime();
    await maybeWarnOrExpire(row.id, elapsedMs, windowMs, 'funded');
  }

  const { rows: paidRows } = await pool.query(
    `SELECT id, paid_at, timer_extension_seconds FROM contracts WHERE state = 'paid'`
  );
  for (const row of paidRows) {
    const windowMs = 24 * 60 * 60 * 1000 + row.timer_extension_seconds * 1000;
    const elapsedMs = Date.now() - new Date(row.paid_at).getTime();
    await maybeWarnOrExpire(row.id, elapsedMs, windowMs, 'paid');
  }
}

const warnedAt: Map<string, Set<number>> = new Map(); // contractId -> set of {50,90} already warned — in-memory, resets on restart, which just means a warning might resend once after a deploy; not worth persisting for a notification-only concern.

async function maybeWarnOrExpire(contractId: string, elapsedMs: number, windowMs: number, state: string) {
  const pct = (elapsedMs / windowMs) * 100;

  if (pct >= 100) {
    try {
      await applyTransition({
        contractId, trigger: 'dispute_timer', actorType: 'system', actorId: null,
        reason: `${state} window expired without resolution`,
        idempotencyKey: `dispute_timer:${contractId}:${state}`,
      });
      // Notification already handled inside applyTransition (spec §4.3).
    } catch (err) {
      console.error(`dispute_timer failed for contract ${contractId}`, err);
    }
    return;
  }

  // Spec §4.2 - "timer expiring" is critical priority (web + Telegram +
  // email), routed through the same outbox as everything else, not a
  // direct email call - this is what makes it respect preferences and
  // land in the bell icon too, not just the inbox.
  const seen = warnedAt.get(contractId) ?? new Set<number>();
  for (const threshold of [50, 90]) {
    if (pct >= threshold && !seen.has(threshold)) {
      seen.add(threshold);
      const { rows } = await pool.query('SELECT reference, vendor_id, customer_id FROM contracts WHERE id = $1', [contractId]);
      const contract = rows[0];
      if (contract) {
        for (const userId of [contract.vendor_id, contract.customer_id]) {
          await emitNotificationStandalone({
            userId, type: threshold === 50 ? 'timer_warning_50' : 'timer_warning_90', priority: 'critical', contractId,
            payload: { reference: contract.reference, pct: threshold },
          });
        }
      }
    }
  }
  warnedAt.set(contractId, seen);
}

export function startEscrowTimerWorker(): void {
  setInterval(async () => {
    try {
      await checkForOutageAndExtend();
      await processRequestedAndAccepted();
      await processFundedAndPaid();
    } catch (err) {
      console.error('escrow timer worker failed', err);
    }
  }, TICK_MS).unref();
}
