// Spec P2 §6.1 - an explicit whitelist, not a set of conditionals. "Any
// transition not in this table is rejected" only holds if the check is
// a table lookup - a missing `else` in conditional logic is exactly the
// failure mode the spec calls out.

export type ContractState =
  | 'requested' | 'accepted' | 'funded' | 'paid' | 'disputed' | 'released' | 'cancelled';

export type TransitionTrigger =
  | 'vendor_accepts'
  | 'cancel_requested' | 'cancel_timer'
  | 'funding_confirmed'
  | 'fiat_marked_paid'
  | 'mutual_refund_broadcast'
  | 'dispute_raised' | 'dispute_timer'
  | 'release_broadcast'
  | 'owner_resolves_to_buyer'
  | 'owner_resolves_to_funder';

interface TransitionRule {
  from: ContractState;
  to: ContractState;
  trigger: TransitionTrigger;
}

// The literal table from spec §6.1 - kept as data, not logic, so it can
// be read against the spec line by line.
const TRANSITIONS: TransitionRule[] = [
  { from: 'requested', to: 'accepted', trigger: 'vendor_accepts' },
  { from: 'requested', to: 'cancelled', trigger: 'cancel_requested' },
  { from: 'requested', to: 'cancelled', trigger: 'cancel_timer' },
  { from: 'accepted', to: 'funded', trigger: 'funding_confirmed' },
  { from: 'accepted', to: 'cancelled', trigger: 'cancel_requested' },
  { from: 'accepted', to: 'cancelled', trigger: 'cancel_timer' },
  { from: 'funded', to: 'paid', trigger: 'fiat_marked_paid' },
  { from: 'funded', to: 'cancelled', trigger: 'mutual_refund_broadcast' },
  { from: 'funded', to: 'disputed', trigger: 'dispute_raised' },
  { from: 'funded', to: 'disputed', trigger: 'dispute_timer' },
  { from: 'paid', to: 'released', trigger: 'release_broadcast' },
  { from: 'paid', to: 'cancelled', trigger: 'mutual_refund_broadcast' },
  { from: 'paid', to: 'disputed', trigger: 'dispute_raised' },
  { from: 'paid', to: 'disputed', trigger: 'dispute_timer' },
  { from: 'disputed', to: 'released', trigger: 'owner_resolves_to_buyer' },
  { from: 'disputed', to: 'cancelled', trigger: 'owner_resolves_to_funder' },
];

// Spec §6.3 - released/cancelled are terminal. No rule in the table above
// has either as a `from` state, so the whitelist already enforces this -
// this export exists for call sites that want to fail fast with a
// specific "terminal contract" error rather than a generic "no such
// transition" one (spec §9: "terminal state check before any build").
const TERMINAL: Set<ContractState> = new Set(['released', 'cancelled']);
export function isTerminal(state: ContractState): boolean {
  return TERMINAL.has(state);
}

export function findTransition(from: ContractState, trigger: TransitionTrigger): TransitionRule | null {
  return TRANSITIONS.find((t) => t.from === from && t.trigger === trigger) ?? null;
}

// Spec §6.2 - the rule that governs everything: from `funded` onward, no
// automatic process may move funds. A timer may only notify or move to
// `disputed`; it can never itself produce `released` or a refund. This
// is enforced by which triggers exist for the timer worker to call -
// see lib/escrowTimers.ts, which only ever calls cancel_timer (pre-funding
// only) and dispute_timer, never anything that broadcasts.
export const TIMER_ALLOWED_TRIGGERS: ReadonlySet<TransitionTrigger> = new Set(['cancel_timer', 'dispute_timer']);
