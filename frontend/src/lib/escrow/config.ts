import type { UtxoChain } from '../network';

// P2 §4A.1 - the platform fee address and the platform xpub are PINNED in
// the client build, never taken from the server at signing time. Set them
// at build time (they are public values):
//   NEXT_PUBLIC_PLATFORM_FEE_ADDRESS_BTC / _LTC
//   NEXT_PUBLIC_PLATFORM_XPUB_BTC / _LTC   (the Owner's Ledger xpub, same as platform_keys)
// Until they are set, every escrow check fails closed.
const PINNED: Record<UtxoChain, { feeAddress: string; platformXpub: string }> = {
  bitcoin: {
    feeAddress: process.env.NEXT_PUBLIC_PLATFORM_FEE_ADDRESS_BTC ?? '',
    platformXpub: process.env.NEXT_PUBLIC_PLATFORM_XPUB_BTC ?? '',
  },
  litecoin: {
    feeAddress: process.env.NEXT_PUBLIC_PLATFORM_FEE_ADDRESS_LTC ?? '',
    platformXpub: process.env.NEXT_PUBLIC_PLATFORM_XPUB_LTC ?? '',
  },
};

export function pinnedFor(chain: UtxoChain): { feeAddress: string; platformXpub: string } | null {
  const p = PINNED[chain];
  return p.feeAddress && p.platformXpub ? p : null;
}
