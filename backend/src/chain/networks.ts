import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';

// Taproot (bc1p…) destinations need the ECC library to be registered
// before bitcoinjs will parse them.
bitcoin.initEccLib(ecc);

export type UtxoChain = 'bitcoin' | 'litecoin';

// Testnet support. Read directly from the environment (not
// config/env) so the chain layer stays importable by standalone scripts.
const NETWORK = process.env.IP2P_NETWORK ?? 'mainnet';
export const isTestnet = NETWORK === 'testnet';

// bitcoinjs-lib ships Bitcoin params only - Litecoin needs its own network
// object (spec §7.2A). Different version bytes, bech32 prefix, WIF prefix.
// Passing Bitcoin params while deriving a Litecoin address produces a
// valid-looking address nobody controls.
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

export const bitcoinNetwork: bitcoin.Network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

export function networkFor(chain: UtxoChain): bitcoin.Network {
  if (chain === 'bitcoin') return bitcoinNetwork;
  return isTestnet ? litecoinTestnetNetwork : litecoinNetwork;
}

// SLIP-44 coin types; every testnet uses 1'.
export function coinTypeFor(chain: UtxoChain): number {
  if (isTestnet) return 1;
  return chain === 'bitcoin' ? 0 : 2;
}

// "valid checksum", validated by the library, not a regex.
// The old check accepted any string that merely started with 1, 3 or bc1.
export function isValidUtxoAddress(address: string, chain: UtxoChain): boolean {
  try {
    bitcoin.address.toOutputScript(address, networkFor(chain));
    return true;
  } catch {
    return false;
  }
}

// Acceptance criterion 14a - asserted in code on every address before it
// is trusted, displayed, stored or funded.
export function assertAddressPrefix(address: string, chain: UtxoChain): void {
  if (!isValidUtxoAddress(address, chain)) {
    throw new Error(`Address "${address}" is not a valid ${chain}${isTestnet ? ' testnet' : ''} address`);
  }
}
