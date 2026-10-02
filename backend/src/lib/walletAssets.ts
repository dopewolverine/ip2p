import { isAddress as isEvmAddress } from 'ethers';
// @ts-ignore - see the note in chain/tronAdapter.ts about tronweb's types.
import TronWeb from 'tronweb';
import { isValidUtxoAddress, coinTypeFor } from '../chain/networks';

export type Asset = 'BTC' | 'LTC' | 'ETH' | 'USDT_ERC20' | 'USDC_ERC20' | 'USDT_TRC20';
export type Chain = 'bitcoin' | 'litecoin' | 'ethereum' | 'tron';

// Spec P1 §1 - six assets, four derivation paths. Canonical and
// server-owned: the client sends an address per asset, never a path.
// BTC/LTC coin types follow IP2P_NETWORK (testnet uses 1').
export const ASSET_CONFIG: Record<Asset, { chain: Chain; derivationPath: string }> = {
  BTC: { chain: 'bitcoin', derivationPath: `m/84'/${coinTypeFor('bitcoin')}'/0'/0/0` },
  LTC: { chain: 'litecoin', derivationPath: `m/84'/${coinTypeFor('litecoin')}'/0'/0/0` },
  ETH: { chain: 'ethereum', derivationPath: "m/44'/60'/0'/0/0" },
  USDT_ERC20: { chain: 'ethereum', derivationPath: "m/44'/60'/0'/0/0" },
  USDC_ERC20: { chain: 'ethereum', derivationPath: "m/44'/60'/0'/0/0" },
  USDT_TRC20: { chain: 'tron', derivationPath: "m/44'/195'/0'/0/0" },
};

export const ALL_ASSETS = Object.keys(ASSET_CONFIG) as Asset[];

// Fail closed using each library's native validator.
// Bitcoin/Litecoin: full decode with checksum and network version bytes.
// Ethereum: 0x + 40 hex, EIP-55 checksum enforced when mixed case (ethers).
// Tron: base58check (tronweb).
export function isValidAddressForChain(address: string, chain: Chain): boolean {
  try {
    if (chain === 'bitcoin' || chain === 'litecoin') return isValidUtxoAddress(address, chain);
    if (chain === 'ethereum') return /^0x[0-9a-fA-F]{40}$/.test(address) && isEvmAddress(address);
    if (chain === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) && TronWeb.isAddress(address);
    return false;
  } catch {
    return false;
  }
}

const ALL_CHAINS: Chain[] = ['bitcoin', 'litecoin', 'ethereum', 'tron'];

// Spec P1 §7.2 - name both chains when the address is valid, but for the wrong chain.
export function validateDestinationAddress(
  address: string,
  targetChain: Chain
): { ok: true } | { ok: false; error: string; detectedChain?: Chain } {
  if (isValidAddressForChain(address, targetChain)) return { ok: true };

  for (const other of ALL_CHAINS) {
    if (other !== targetChain && isValidAddressForChain(address, other)) {
      return {
        ok: false,
        error: `That looks like a ${other} address, not a ${targetChain} address.`,
        detectedChain: other,
      };
    }
  }

  return { ok: false, error: `That is not a valid ${targetChain} address.` };
}
