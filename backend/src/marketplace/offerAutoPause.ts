import { pool } from '../db/pool';
import { sendEmail } from '../lib/email';
import { emitNotificationStandalone } from '../lib/notifications';

// Spec P3 §3.4 - offers auto-pause when the vendor hasn't logged in for
// 48 hours. "Nothing else changes" (price/terms/limits untouched); "vendor
// logs in → offers reactivate automatically" (handled in login.ts, not
// here - see the note at the bottom of this file); "vendor is notified
// when it happens."
const INACTIVITY_HOURS = 48;

export function startOfferAutoPauseWorker(): void {
  setInterval(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT o.id, o.vendor_id, u.email
         FROM offers o
         JOIN users u ON u.id = o.vendor_id
         WHERE o.status = 'active'
           AND (u.last_login_at IS NULL OR u.last_login_at < now() - interval '${INACTIVITY_HOURS} hours')`
      );

      for (const row of rows) {
        await pool.query(
          `UPDATE offers SET status = 'paused', paused_reason = 'vendor_inactive', updated_at = now() WHERE id = $1`,
          [row.id]
        );
        if (row.email) {
          await sendEmail(
            row.email,
            'Your offer was paused — inactivity',
            `One of your offers was automatically paused because you haven't logged in for ${INACTIVITY_HOURS} hours. ` +
              `Price, terms, and limits are unchanged. Log in to reactivate it automatically.`
          );
        }
        await emitNotificationStandalone({
          userId: row.vendor_id, type: 'offer_auto_paused', priority: 'low',
          dedupeKey: `${row.id}:${Date.now()}`,
        });
      }
    } catch (err) {
      console.error('offerAutoPauseWorker failed', err);
    }
  }, 60 * 60 * 1000).unref(); // hourly is plenty for a 48-hour threshold
}

// Reactivation-on-login lives in login.ts (see the last_login_at update
// there) rather than here, so it happens in the exact same transaction
// as recording the login itself - see reactivateVendorOffers, called
// from login.ts right after last_login_at is set.
export async function reactivateVendorOffers(vendorId: string): Promise<void> {
  await pool.query(
    `UPDATE offers SET status = 'active', paused_reason = NULL, updated_at = now()
     WHERE vendor_id = $1 AND status = 'paused' AND paused_reason = 'vendor_inactive'`,
    [vendorId]
  );
}
