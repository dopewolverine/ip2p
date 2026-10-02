import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';

bitcoin.initEccLib(ecc);

export type UtxoChain = 'bitcoin' | 'litecoin';

// Testnet support. Set NEXT_PUBLIC_IP2P_NETWORK=testnet at
// build time; it must match the backend's IP2P_NETWORK.
export const IS_TESTNET = process.env.NEXT_PUBLIC_IP2P_NETWORK === 'testnet';

// One copy of the Litecoin params for the whole frontend (they were
// duplicated in four files). Same values as backend/src/chain/networks.ts.
export const litecoinNetwork: bitcoin.Network = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

export const litecoinTestnetNetwork: bitcoin.Network = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'tltc',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0x3a,
  wif: 0xef,
};

export function networkForChain(chain: UtxoChain): bitcoin.Network {
  if (chain === 'bitcoin') return IS_TESTNET ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  return IS_TESTNET ? litecoinTestnetNetwork : litecoinNetwork;
}

export function chainForAsset(asset: 'BTC' | 'LTC'): UtxoChain {
  return asset === 'BTC' ? 'bitcoin' : 'litecoin';
}

export function coinType(chain: UtxoChain): number {
  if (IS_TESTNET) return 1;
  return chain === 'bitcoin' ? 0 : 2;
}

// P1 §4.1 wallet receive path; P2 §4.1 per-contract escrow path.
export function walletPath(asset: 'BTC' | 'LTC'): string {
  return `m/84'/${coinType(chainForAsset(asset))}'/0'/0/0`;
}

export function escrowPath(chain: UtxoChain, contractIndex: number): string {
  return `m/45'/${coinType(chain)}'/${contractIndex}'`;
}

// Full library decode (checksum + version bytes / HRP), not a prefix regex.
export function isValidUtxoAddress(address: string, chain: UtxoChain): boolean {
  try {
    bitcoin.address.toOutputScript(address, networkForChain(chain));
    return true;
  } catch {
    return false;
  }
}
