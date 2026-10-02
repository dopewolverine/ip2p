import { pool } from '../db/pool';
import { sendEmail } from './email';
import { sendTelegramMessage } from './telegramBot';

// Spec §4.3 - "deliveries are separate rows. One notification produces
// up to three attempts, each failing and retrying independently. A
// Telegram outage must not block the email." Each channel is attempted
// and marked independently; one failing never touches the others'
// rows, since each is a separate UPDATE on its own delivery id.

const MESSAGES: Record<string, (payload: any) => { subject: string; text: string }> = {
  trade_requested: (p) => ({ subject: 'New trade request', text: `You have a new trade request (${p?.reference ?? ''}). Respond within 30 minutes.` }),
  trade_accepted: (p) => ({ subject: 'Trade accepted', text: `Your trade ${p?.reference ?? ''} was accepted.` }),
  trade_declined: (p) => ({ subject: 'Trade declined', text: `Your trade ${p?.reference ?? ''} was declined.` }),
  trade_cancelled: (p) => ({ subject: 'Trade cancelled', text: `Trade ${p?.reference ?? ''} was cancelled.` }),
  escrow_funded: (p) => ({ subject: 'Escrow funded — send payment now', text: `Escrow for trade ${p?.reference ?? ''} is funded. Send payment now.` }),
  payment_marked: (p) => ({ subject: 'Payment marked as sent', text: `The buyer marked payment as sent for trade ${p?.reference ?? ''}. Please confirm and release.` }),
  timer_warning_50: (p) => ({ subject: 'Trade window 50% elapsed', text: `Trade ${p?.reference ?? ''} is halfway through its window.` }),
  timer_warning_90: (p) => ({ subject: 'Trade window closing soon', text: `Trade ${p?.reference ?? ''} is 90% through its window — act soon.` }),
  timer_expired: (p) => ({ subject: 'Trade timed out', text: `Trade ${p?.reference ?? ''}'s window expired.` }),
  trade_released: (p) => ({ subject: 'Trade released', text: `Trade ${p?.reference ?? ''} was released.` }),
  dispute_opened: (p) => ({ subject: 'Dispute opened', text: `A dispute was opened on trade ${p?.reference ?? ''}.` }),
  dispute_resolved: (p) => ({ subject: 'Dispute resolved', text: `The dispute on trade ${p?.reference ?? ''} was resolved.` }),
  dispute_escalated: (p) => ({ subject: 'Dispute needs your decision', text: `Dispute on trade ${p?.reference ?? ''} has been open over 48 hours without a decision.` }),
  deposit_confirmed: (p) => ({ subject: 'Deposit confirmed', text: `Your ${p?.asset ?? ''} deposit is confirmed.` }),
  withdrawal_confirmed: (p) => ({ subject: 'Withdrawal confirmed', text: `Your ${p?.asset ?? ''} withdrawal is confirmed.` }),
  offer_auto_paused: () => ({ subject: 'Offer paused', text: `One of your offers was paused for inactivity.` }),
  new_chat_message: (p) => ({ subject: 'New message', text: `New message on trade ${p?.reference ?? ''}.` }),
  new_device_login: (p) => ({ subject: 'New login to your account', text: `A new login was detected${p?.ip_hash ? '' : ''}. If this wasn't you, reset your password immediately.` }),
  password_changed: () => ({ subject: 'Your password was changed', text: `Your account password was just changed.` }),
  totp_changed: (p) => ({ subject: 'Two-factor authentication changed', text: `2FA was ${p?.action ?? 'changed'} on your account.` }),
  recovery_code_used: () => ({ subject: 'Recovery code used', text: `A 2FA recovery code was just used to log in.` }),
  seed_recovery_used: () => ({ subject: 'Account recovered with seed phrase', text: `Your account was just recovered using your seed phrase.` }),
  escrow_underfunded: (p) => ({ subject: 'Escrow underfunded', text: `The escrow for trade ${p?.reference ?? ''} received ${p?.received ?? '?'} but needs ${p?.required ?? '?'} in a single payment. The trade will not start. If it is cancelled, the coins can be refunded from the trade page.` }),
  escrow_stranded_funds: (p) => ({ subject: 'Coins waiting in a cancelled trade', text: `Coins arrived at the escrow address of cancelled trade ${p?.reference ?? ''}. Open the trade to refund them to the seller.` }),
  escrow_signature_requested: (p) => ({ subject: 'Your signature is needed', text: `Your counterparty signed the ${p?.purpose ?? 'transaction'} for trade ${p?.reference ?? ''}. Open the trade to review it and add your signature.` }),
  escrow_security_alert: (p) => ({ subject: 'SECURITY: escrow verification failed', text: `A client refused to sign on trade ${p?.reference ?? ''} (check: ${p?.check ?? 'unknown'}). Investigate before anyone signs anything on this trade.` }),
  payment_details_shared: (p) => ({ subject: 'Payment details received', text: `The seller shared payment details for trade ${p?.reference ?? ''}. Open the trade to see where to send the payment.` }),
};

async function deliverOne(delivery: { id: string; channel: string; notification_id: string }): Promise<void> {
  const { rows } = await pool.query(
    `SELECT n.type, n.payload, n.user_id, u.email
     FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.id = $1`,
    [delivery.notification_id]
  );
  const notif = rows[0];
  if (!notif) return;

  const build = MESSAGES[notif.type];
  const { subject, text } = build ? build(notif.payload) : { subject: notif.type, text: notif.type };

  try {
    if (delivery.channel === 'web') {
      // The row's existence in `notifications` already backs the bell
      // icon (GET /notifications reads it directly) - "delivery" here
      // just means marking it done, nothing to transmit.
    } else if (delivery.channel === 'email') {
      if (!notif.email) throw new Error('no email on file');
      await sendEmail(notif.email, subject, text);
    } else if (delivery.channel === 'telegram') {
      const { rows: linkRows } = await pool.query('SELECT chat_id FROM telegram_links WHERE user_id = $1', [notif.user_id]);
      if (!linkRows[0]) throw new Error('no telegram link');
      await sendTelegramMessage(linkRows[0].chat_id, `${subject}\n${text}`);
    }

    await pool.query(
      `UPDATE notification_deliveries SET status = 'delivered', delivered_at = now(), attempts = attempts + 1, last_attempt_at = now() WHERE id = $1`,
      [delivery.id]
    );
  } catch (err) {
    console.error(`delivery failed: notification ${delivery.notification_id} via ${delivery.channel}`, err);
    await pool.query(
      `UPDATE notification_deliveries SET status = 'failed', attempts = attempts + 1, last_attempt_at = now() WHERE id = $1`,
      [delivery.id]
    );
  }
}

export function startNotificationDeliveryWorker(): void {
  setInterval(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT id, channel, notification_id FROM notification_deliveries WHERE status = 'pending' LIMIT 100`
      );
      for (const row of rows) {
        await deliverOne(row);
      }
    } catch (err) {
      console.error('notification delivery worker failed', err);
    }
  }, 15_000).unref(); // spec doesn't set an interval; critical events (funded, dispute) deserve sub-minute latency
}
