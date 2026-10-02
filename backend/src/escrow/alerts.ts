import { pool } from '../db/pool';
import { emitNotificationStandalone, NotificationType } from '../lib/notifications';

// Staff with 2FA enabled (DEV-BRIEF §4A) - the only accounts that count as staff.
export async function notifyStaff(type: NotificationType, contractId: string | null, payload: Record<string, unknown>): Promise<void> {
  const { rows } = await pool.query(`SELECT id FROM users WHERE role IN ('owner', 'staff') AND totp_enabled = true`);
  for (const r of rows) {
    await emitNotificationStandalone({
      userId: r.id, type, priority: 'security', contractId: null,
      payload: { ...payload, contract_id: contractId }, dedupeKey: `${contractId ?? ''}:${Date.now()}`,
    });
  }
}

// P2 §4A.1 - "Any mismatch aborts the signature and raises a security alert."
export async function recordSecurityAlert(params: {
  userId: string | null; contractId: string | null; check: string; details?: Record<string, unknown> | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO security_alerts (user_id, contract_id, check_name, details) VALUES ($1, $2, $3, $4)`,
    [params.userId, params.contractId, params.check, params.details ?? null]
  );
  let reference: string | null = null;
  if (params.contractId) {
    const { rows } = await pool.query('SELECT reference FROM contracts WHERE id = $1', [params.contractId]);
    reference = rows[0]?.reference ?? null;
  }
  await notifyStaff('escrow_security_alert', params.contractId, { reference, check: params.check });
}
