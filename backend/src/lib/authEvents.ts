import { pool } from '../db/pool';

export type AuthEventType =
  | 'register_started' | 'register_completed' | 'seed_confirmed'
  | 'login_success' | 'login_failed'
  | 'totp_success' | 'totp_failed'
  | 'logout'
  | 'password_reset_requested' | 'password_reset_completed'
  | 'stepup_failed'
  | 'totp_enabled' | 'totp_disable_requested' | 'totp_disabled'
  | 'recovery_code_used'
  | 'seed_recovery_challenge' | 'seed_recovery_success' | 'seed_recovery_failed'
  | 'session_revoked' | 'account_disabled' | 'account_deleted'
  | 'password_changed' | 'password_set_after_recovery';

export async function logAuthEvent(params: {
  userId?: string | null;
  eventType: AuthEventType;
  ipHash?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO auth_events (user_id, event_type, ip_hash, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.userId ?? null,
      params.eventType,
      params.ipHash ?? null,
      params.userAgent ?? null,
      params.metadata ?? null,
    ]
  );
}
