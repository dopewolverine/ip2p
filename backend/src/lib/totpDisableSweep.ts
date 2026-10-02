import { pool } from '../db/pool';
import { logAuthEvent } from './authEvents';

// Executes 2FA disables whose 48-hour delay (spec §9) has elapsed.
export function startTotpDisableSweep(): void {
  setInterval(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE totp_disable_due_at IS NOT NULL AND totp_disable_due_at <= now()`
      );

      for (const row of rows) {
        await pool.query(
          `UPDATE users
           SET totp_enabled = false, totp_secret_enc = NULL, totp_disable_due_at = NULL, updated_at = now()
           WHERE id = $1`,
          [row.id]
        );
        await logAuthEvent({ userId: row.id, eventType: 'totp_disabled' });
      }
    } catch (err) {
      console.error('totpDisableSweep failed', err);
    }
  }, 60_000).unref();
}
