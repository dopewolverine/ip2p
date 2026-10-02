import type { Chain } from '../chain/types';

// Spec P1 §6.2 - per-chain confirmation depth. Bitcoin gets a second,
// deeper threshold for amounts above a configurable cutoff (spec: "the
// large-amount threshold is a config value, not a constant in code" -
// LARGE_AMOUNT_SATOSHIS is that value; change it without touching logic
// elsewhere). Not yet measured against real settlement times per the
// spec's own "known unknowns" section - revisit before relying on these
// for anything high-value.
const STANDARD: Record<Chain, number> = {
  bitcoin: 2,
  litecoin: 6,
  ethereum: 12,
  tron: 19, // one full SR round
};

const BITCOIN_LARGE_AMOUNT_THRESHOLD = 3;
const LARGE_AMOUNT_SATOSHIS = 100_000_000n; // 1 BTC — placeholder, tune for real use

export function confirmationsRequired(chain: Chain, amountBaseUnits: string): number {
  if (chain === 'bitcoin' && BigInt(amountBaseUnits) >= LARGE_AMOUNT_SATOSHIS) {
    return BITCOIN_LARGE_AMOUNT_THRESHOLD;
  }
  return STANDARD[chain];
}
