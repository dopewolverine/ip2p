import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory, BIP32Interface } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import { networkFor, coinTypeFor, UtxoChain, litecoinNetwork, litecoinTestnetNetwork } from '../chain/networks';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

// Spec P2 §4.1 step 5 - BIP-67 lexicographic sort.
export function sortPubkeysBip67(pubkeys: Buffer[]): Buffer[] {
  return [...pubkeys].sort((a, b) => a.compare(b));
}

// Spec §4.1 steps 5-6 - 2-of-3 P2WSH from the three sorted pubkeys.
export function buildEscrowScriptFor(
  chain: UtxoChain,
  pubkeysHex: [string, string, string]
): { witnessScript: string; address: string } {
  const network = networkFor(chain);
  const sorted = sortPubkeysBip67(pubkeysHex.map((h) => Buffer.from(h, 'hex')));
  const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: sorted, network });
  const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });
  if (!p2wsh.address || !p2ms.output) throw new Error('failed to construct escrow script/address');
  return { witnessScript: p2ms.output.toString('hex'), address: p2wsh.address };
}

// Contract_index is a Postgres bigint, which node-postgres
// returns as a string. Passing "5" to bip32's derive() throws
// "Expected UInt32, got String" - every escrow address creation crashed.
export function parseContractIndex(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isSafeInteger(n) || n < 0 || n >= 0x80000000) throw new Error('invalid_contract_index');
  return n;
}

export function expectedEscrowPath(chain: UtxoChain, contractIndex: number): string {
  return `m/45'/${coinTypeFor(chain)}'/${contractIndex}'`;
}

export function isCompressedPubkey(hex: string): boolean {
  if (!/^[0-9a-fA-F]{66}$/.test(hex)) return false;
  const buf = Buffer.from(hex, 'hex');
  return (buf[0] === 0x02 || buf[0] === 0x03) && ecc.isPoint(buf);
}

// Ledger exports may use Bitcoin or Litecoin version bytes; accept any
// PUBLIC extended key. A private key here is a critical incident (P2 §3).
export function parseNeuteredXpub(xpub: string, chain: UtxoChain): BIP32Interface {
  const candidates = [networkFor(chain), bitcoin.networks.bitcoin, bitcoin.networks.testnet, litecoinNetwork, litecoinTestnetNetwork];
  for (const net of candidates) {
    let node: BIP32Interface;
    try {
      node = bip32.fromBase58(xpub, net);
    } catch {
      continue;
    }
    if (!node.isNeutered()) throw new Error('platform_key_is_private');
    return node;
  }
  throw new Error('invalid_platform_xpub');
}

// Spec §4.1 step 4 - public-key-only derivation of child n from the xpub.
export function derivePlatformPubkey(xpub: string, chain: UtxoChain, contractIndex: number): string {
  const idx = parseContractIndex(contractIndex);
  return Buffer.from(parseNeuteredXpub(xpub, chain).derive(idx).publicKey).toString('hex');
}
