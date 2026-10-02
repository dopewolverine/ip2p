// P5 §5, §7 - "thresholds are configuration values, set against real
// data after launch. The structure is fixed; the numbers are not."
// Placeholder numbers below are reasonable starting guesses, not
// measured against anything - expect to retune these once real trade
// data exists.

export const BADGE_THRESHOLDS = {
  established: { distinctCounterparties: 5, accountAgeDays: 14, completionRate: 0.9 },
  trusted: { distinctCounterparties: 25, accountAgeDays: 60, completionRate: 0.97, volumeUsd: 10_000 },
};

// P5 §7 - tier 4 enforcement. Tiers 1-3 have no gate at all (checked by
// the callers below, not by anything in this file).
export const TIER_4_MIN_REPUTATION_TRADES = 10; // minimum total_trades to open a tier 4 offer
export const TIER_4_NEW_ACCOUNT_MIN_AGE_DAYS = 30;
