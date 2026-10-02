import { pool } from '../db/pool';
import { emitNotificationStandalone } from './notifications';

// Spec P4 §3.3 - "escalation notification to the Owner if a dispute is
// open more than 48 hours without a decision." "Decision" = contracts.resolution
// set (via the admin /decide endpoint) - not yet resolved/broadcast, just decided.
export function startDisputeEscalationWorker(): void {
  setInterval(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT d.id, d.contract_id, c.reference
         FROM disputes d
         JOIN contracts c ON c.id = d.contract_id
         WHERE c.state = 'disputed'
           AND c.resolution IS NULL
           AND d.escalated_at IS NULL
           AND d.opened_at < now() - interval '48 hours'`
      );

      if (rows.length === 0) return;

      const { rows: owners } = await pool.query(`SELECT id FROM users WHERE role = 'owner'`);

      for (const dispute of rows) {
        for (const owner of owners) {
          await emitNotificationStandalone({
            userId: owner.id,
            type: 'dispute_escalated',
            priority: 'critical',
            contractId: dispute.contract_id,
            payload: { reference: dispute.reference },
          });
        }
        await pool.query('UPDATE disputes SET escalated_at = now() WHERE id = $1', [dispute.id]);
      }
    } catch (err) {
      console.error('disputeEscalationWorker failed', err);
    }
  }, 15 * 60_000).unref(); // 15 min is plenty of resolution for a 48h threshold
}
