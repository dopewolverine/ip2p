// Spec P2 §4A.4, §8A - fee and dust handling, computed once at contract
// creation and snapshotted onto the contract row forever after. Never
// recomputed from live config once a contract exists (§3: "changing the
// rate never affects an open trade").

export const FEE_RATE_BPS = 300; // 3%, all assets (§5.3, §8A)

const DUST_THRESHOLD: Record<string, bigint> = {
  bitcoin: 546n,   // P2WPKH — the release tx's fee output type
  litecoin: 5460n,
  ethereum: 0n,    // no dust concept for token transfers
  tron: 0n,
};

// Configuration, not a derived constant (spec §4A.4) - set so a zero-fee
// trade is the rare edge case, not the routine outcome. At 300bps, BTC's
// fee crosses the P2WPKH dust threshold around 18,200 sats of trade value.
const MIN_TRADE: Record<string, bigint> = {
  bitcoin: 20_000n,        // sats
  litecoin: 200_000n,      // litoshi
  ethereum: 0n,             // enforced differently — no dust concept, left at 0 deliberately
  tron: 0n,
};

export function checkMinTrade(chain: string, amountBaseUnits: string): boolean {
  const min = MIN_TRADE[chain] ?? 0n;
  return BigInt(amountBaseUnits) >= min;
}

// Spec §4A.4 - computed at contract creation, not at broadcast. By
// broadcast time both parties have signed and the trade is committed;
// finding a dust problem there means an unrecoverable stuck trade.
export function computeFee(chain: string, amountBaseUnits: string): { feeAmount: string; feeRateBps: number } {
  const amount = BigInt(amountBaseUnits);
  let fee = (amount * BigInt(FEE_RATE_BPS)) / 10_000n;

  const dust = DUST_THRESHOLD[chain] ?? 0n;
  if (dust > 0n && fee < dust) {
    fee = 0n; // the zero-fee branch — must still be exercised in testing, not just implemented
  }

  return { feeAmount: fee.toString(), feeRateBps: FEE_RATE_BPS };
}

// Spec §8A - fee is charged on release and on dispute resolution
// (either direction); never on a mutual refund or a pre-funding cancel.
export function feeAppliesTo(resolution: 'released_to_buyer' | 'refunded_to_funder', wasDisputed: boolean): boolean {
  if (resolution === 'released_to_buyer') return true;
  // refunded_to_funder: charged only if it went through a dispute
  // (arbitration happened); a mutual refund charges nothing.
  return wasDisputed;
}
