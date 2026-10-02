import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { findTransition, isTerminal, ContractState, TransitionTrigger } from './stateMachine';
import { applyTransitionEffects } from './transitionEffects';

export class TransitionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface ApplyTransitionParams {
  contractId: string;
  trigger: TransitionTrigger;
  actorType: 'user' | 'system' | 'admin';
  actorId: string | null;
  reason: string | null;
  idempotencyKey: string;
  settlementConfirmed?: boolean;
}

// Spec §9 - a contract pays out exactly once, ever. The row lock plus the
// unique idempotency_key make that structural.
//
// A
// caller that already holds an open transaction (funding confirmation,
// release finalisation) passes its client, so the state change commits
// atomically with the write that caused it.
export async function applyTransition(params: ApplyTransitionParams, externalClient?: PoolClient): Promise<ContractState> {
  if (externalClient) return runTransition(externalClient, params);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await runTransition(client, params);
    await client.query('COMMIT');
    return state;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof TransitionError) throw err;
    if ((err as any)?.code === '23505') {
      throw new TransitionError('duplicate_request', 'This exact transition was already recorded');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function runTransition(client: PoolClient, params: ApplyTransitionParams): Promise<ContractState> {
  const { rows } = await client.query(`SELECT state FROM contracts WHERE id = $1 FOR UPDATE`, [params.contractId]);
  const contract = rows[0];
  if (!contract) throw new TransitionError('not_found', 'Contract not found');

  if (!params.settlementConfirmed) {
    const payout = await client.query(`SELECT 1 FROM broadcasts WHERE contract_id = $1 AND status IN ('signed', 'broadcast') LIMIT 1`, [params.contractId]);
    if (payout.rows[0]) throw new TransitionError('settlement_pending', 'A signed settlement is pending; the trade cannot change state');
  }
  const fromState = contract.state as ContractState;
  if (isTerminal(fromState)) {
    throw new TransitionError('terminal_contract', `Contract is already ${fromState} (terminal)`);
  }

  const rule = findTransition(fromState, params.trigger);
  if (!rule) {
    throw new TransitionError('invalid_transition', `No transition from ${fromState} via ${params.trigger}`);
  }

  await client.query(
    `INSERT INTO contract_transitions
       (contract_id, from_state, to_state, actor_type, actor_id, reason, idempotency_key, trigger)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [params.contractId, fromState, rule.to, params.actorType, params.actorId, params.reason, params.idempotencyKey, params.trigger]
  );

  // accepted_at and paid_at drive the accepted and paid timers; they are
  // set here, once, by the transition.
  const stamps: Partial<Record<ContractState, string>> = {
    accepted: 'accepted_at = COALESCE(accepted_at, now())',
    paid: 'paid_at = COALESCE(paid_at, now())',
  };
  const extra = stamps[rule.to] ? `, ${stamps[rule.to]}` : '';
  await client.query(`UPDATE contracts SET state = $1${extra} WHERE id = $2`, [rule.to, params.contractId]);

  if (isTerminal(rule.to)) {
    await client.query(`UPDATE contracts SET closed_at = now() WHERE id = $1`, [params.contractId]);
  }

  if (rule.to === 'disputed') {
    await client.query(`DELETE FROM broadcasts WHERE contract_id = $1 AND status IN ('proposed', 'partially_signed')`, [params.contractId]);
  }
  if (params.trigger === 'dispute_timer') {
    await client.query(
      `INSERT INTO disputes (contract_id, opened_by, reason_code, reason_text)
       VALUES ($1, NULL, 'timer_expired', $2) ON CONFLICT (contract_id) DO NOTHING`,
      [params.contractId, params.reason ?? 'Trade window expired']);
  }
  await applyTransitionEffects(client, {
    contractId: params.contractId, trigger: params.trigger, toState: rule.to, reason: params.reason,
  });

  return rule.to;
}
