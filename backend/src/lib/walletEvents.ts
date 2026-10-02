import { pool } from '../db/pool';

// Spec P1 §10 - the exact event vocabulary the spec lists, log-only
// (no private keys, no seed, no signed tx bodies, no export response -
// every call site below passes only asset codes and non-sensitive metadata).
export type WalletEventType =
  | 'address_generated'
  | 'balance_queried'
  | 'transaction_built'
  | 'transaction_broadcast'
  | 'deposit_detected'
  | 'deposit_confirmed'
  | 'export_requested'
  | 'address_validation_failed';

export async function logWalletEvent(params: {
  userId: string;
  eventType: WalletEventType;
  asset?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO wallet_events (user_id, event_type, asset, metadata) VALUES ($1, $2, $3, $4)`,
      [params.userId, params.eventType, params.asset ?? null, params.metadata ?? null]
    );
  } catch (err) {
    // Logging must never break the action it's describing.
    console.error('logWalletEvent failed', err);
  }
}
