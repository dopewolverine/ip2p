import { PoolClient } from 'pg';
import { TransitionTrigger, ContractState } from './stateMachine';
import { emitNotification, NotificationPriority, NotificationType } from '../lib/notifications';

interface ContractInfo {
  reference: string;
  vendor_id: string;
  customer_id: string;
  crypto_side: 'vendor' | 'customer';
}

// Spec §2.3 - "injected automatically on every state transition... these
// appear inline in the thread so the dispute record is self-contained."
function systemMessageFor(trigger: TransitionTrigger, toState: ContractState, reason: string | null): string {
  const withReason = (base: string) => (reason ? `${base} (${reason})` : base);
  switch (trigger) {
    case 'vendor_accepts': return 'Trade accepted by the vendor.';
    case 'cancel_requested': return withReason('Trade cancelled.');
    case 'cancel_timer': return 'Trade automatically cancelled — response window expired.';
    case 'funding_confirmed': return 'Escrow funded and confirmed on-chain.';
    case 'fiat_marked_paid': return 'Payment marked as sent.';
    case 'mutual_refund_broadcast': return 'Funds refunded to the funder.';
    case 'dispute_raised': return withReason('Dispute opened.');
    case 'dispute_timer': return 'Trade automatically moved to dispute — window expired without resolution.';
    case 'release_broadcast': return 'Funds released.';
    case 'owner_resolves_to_buyer': return withReason('Dispute resolved — funds released to the buyer.');
    case 'owner_resolves_to_funder': return withReason('Dispute resolved — funds returned to the funder.');
    default: return `Trade moved to ${toState}.`;
  }
}

// Spec §4.2's table, mapped onto triggers. Vendor/customer are resolved
// to specific notification recipients based on who actually needs to
// act (e.g. escrow_funded goes to the fiat side, who must pay next -
// not both parties equally, since only one of them has an action to take).
async function notificationTargetsFor(
  trigger: TransitionTrigger,
  contract: ContractInfo
): Promise<Array<{ userId: string; type: NotificationType; priority: NotificationPriority }>> {
  const fiatSideId = contract.crypto_side === 'vendor' ? contract.customer_id : contract.vendor_id;
  const cryptoSideId = contract.crypto_side === 'vendor' ? contract.vendor_id : contract.customer_id;
  const both = [contract.vendor_id, contract.customer_id];

  switch (trigger) {
    case 'vendor_accepts':
      return [{ userId: contract.customer_id, type: 'trade_accepted', priority: 'normal' }];
    case 'cancel_requested':
    case 'cancel_timer':
    case 'mutual_refund_broadcast':
      return both.map((userId) => ({ userId, type: 'trade_cancelled', priority: 'normal' }));
    case 'funding_confirmed':
      // Critical - "fiat side must pay" is the exact spec example for this priority.
      return [{ userId: fiatSideId, type: 'escrow_funded', priority: 'critical' }];
    case 'fiat_marked_paid':
      return [{ userId: cryptoSideId, type: 'payment_marked', priority: 'critical' }];
    case 'dispute_raised':
    case 'dispute_timer':
      return both.map((userId) => ({ userId, type: 'dispute_opened', priority: 'critical' }));
    case 'release_broadcast':
      return both.map((userId) => ({ userId, type: 'trade_released', priority: 'normal' }));
    case 'owner_resolves_to_buyer':
    case 'owner_resolves_to_funder':
      return both.map((userId) => ({ userId, type: 'dispute_resolved', priority: 'normal' }));
    default:
      return [];
  }
}

// Called from inside applyTransition's own open transaction - spec §4.3
// requires the notification row and the state change to commit
// together, and §2.3 requires the same for the system chat message
// (both are just more writes in the same already-open client).
export async function applyTransitionEffects(
  client: PoolClient,
  params: { contractId: string; trigger: TransitionTrigger; toState: ContractState; reason: string | null }
): Promise<void> {
  const { rows } = await client.query(
    `SELECT reference, vendor_id, customer_id, crypto_side FROM contracts WHERE id = $1`,
    [params.contractId]
  );
  const contract: ContractInfo = rows[0];
  if (!contract) return;

  await client.query(
    `INSERT INTO messages (contract_id, sender_type, sender_id, body) VALUES ($1, 'system', NULL, $2)`,
    [params.contractId, systemMessageFor(params.trigger, params.toState, params.reason)]
  );

  const targets = await notificationTargetsFor(params.trigger, contract);
  for (const target of targets) {
    await emitNotification(client, {
      userId: target.userId,
      type: target.type,
      priority: target.priority,
      contractId: params.contractId,
      payload: { reference: contract.reference },
    });
  }
}
