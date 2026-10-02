import { PoolClient } from 'pg';
import { pool } from '../db/pool';

// Spec P4 §4.2 - priority determines channel.
export type NotificationPriority = 'critical' | 'normal' | 'low' | 'security';

const CHANNELS_FOR_PRIORITY: Record<NotificationPriority, Array<'web' | 'email' | 'telegram'>> = {
  critical: ['web', 'telegram', 'email'],
  normal: ['web', 'telegram'],
  low: ['web'],
  // Always, unmuted. FIX: 'web' added - email is optional at signup, so an
  // account without an address previously received security alerts on no
  // channel at all.
  security: ['email', 'web'],
};

export type NotificationType =
  | 'trade_requested' | 'trade_accepted' | 'trade_declined' | 'trade_cancelled'
  | 'escrow_funded' | 'payment_marked' | 'timer_warning_50' | 'timer_warning_90' | 'timer_expired'
  | 'trade_released' | 'dispute_opened' | 'dispute_resolved' | 'dispute_escalated'
  | 'deposit_confirmed' | 'withdrawal_confirmed' | 'offer_auto_paused'
  | 'new_chat_message'
  | 'new_device_login' | 'password_changed' | 'totp_changed' | 'recovery_code_used' | 'seed_recovery_used'
  | 'escrow_underfunded' | 'escrow_stranded_funds' | 'escrow_signature_requested' | 'escrow_security_alert'
  | 'payment_details_shared';

// Spec §4.3 - "write the notification row in the SAME database
// transaction as the state change that caused it." This is why every
// call site passes its own already-open `client`, never the shared
// pool - using the pool here would open a second, independent
// transaction and defeat the entire point.
//
// The unique constraint (user_id, type, contract_id) means a retried
// caller is a safe no-op: ON CONFLICT DO NOTHING, not an error.
export async function emitNotification(
  client: PoolClient,
  params: {
    userId: string;
    type: NotificationType;
    priority: NotificationPriority;
    contractId?: string | null;
    payload?: Record<string, unknown> | null;
    // See the schema comment on notifications.dedupe_key. Leave unset
    // for contract-scoped events (contract_id already makes each one
    // unique). Pass a fresh value (e.g. `Date.now()` or a random token)
    // for non-contract events that can legitimately recur - omitting it
    // there means every occurrence after the first is silently dropped.
    dedupeKey?: string;
  }
): Promise<void> {
  const { rows } = await client.query(
    `INSERT INTO notifications (user_id, type, priority, contract_id, payload, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, type, contract_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [params.userId, params.type, params.priority, params.contractId ?? null, params.payload ?? null, params.dedupeKey ?? '']
  );
  const notification = rows[0];
  if (!notification) return; // duplicate — spec §4.3, "cannot fire the same alert twice"

  // Spec §4.2 - security notifications ignore preferences entirely
  // (cannot be muted); every other priority is filtered by what the
  // user has enabled, checked here rather than by the delivery worker,
  // so a muted channel never even gets a pending row.
  let channels = CHANNELS_FOR_PRIORITY[params.priority];
  if (params.priority !== 'security') {
    const { rows: prefRows } = await client.query(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [params.userId]
    );
    const prefs = prefRows[0];
    if (prefs) {
      channels = channels.filter((ch) => {
        const key = `${params.priority}_${ch}`;
        return prefs[key] !== false; // default true if the column doesn't exist for this priority/channel pair
      });
    }
  }

  for (const channel of channels) {
    await client.query(
      `INSERT INTO notification_deliveries (notification_id, channel, status) VALUES ($1, $2, 'pending')`,
      [notification.id, channel]
    );
  }
}

// Convenience for call sites that legitimately have no open transaction
// of their own (e.g. a pure notification with nothing else to commit
// alongside it) - still goes through the pool's own implicit
// single-statement transaction semantics via a dedicated client.
export async function emitNotificationStandalone(params: Parameters<typeof emitNotification>[1]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await emitNotification(client, params);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
