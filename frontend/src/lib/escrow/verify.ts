import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { networkForChain, escrowPath, walletPath, isValidUtxoAddress, UtxoChain } from '../network';
import { pinnedFor } from './config';

bitcoin.initEccLib(ecc);

// P2 §4A.1 - everything the browser checks before it will show an escrow
// address to fund, or sign a transaction out of escrow. Nothing here
// trusts the server: the platform key comes from the pinned xpub, the
// user's own key and payout address are re-derived from the seed, and
// the escrow address is rebuilt from the three keys.
export class VerificationError extends Error {
  constructor(public check: string, message: string) {
    super(message);
  }
}
const fail = (check: string, message: string): never => { throw new VerificationError(check, message); };
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

export const DUST: Record<UtxoChain, bigint> = { bitcoin: 546n, litecoin: 5460n };
const MIN_RELAY: Record<UtxoChain, bigint> = { bitcoin: 1n, litecoin: 10n };
const MAX_RATE: Record<UtxoChain, bigint> = { bitcoin: 500n, litecoin: 1000n };
const OVERHEAD_VB = 11n;
const ESCROW_INPUT_VB = 105n;

export type Party = 'vendor' | 'customer';

export interface EscrowKeysView {
  vendor: string | null; customer: string | null; platform: string | null;
  vendor_payout: string | null; customer_payout: string | null;
}

function seedRoot(mnemonic: string): HDKey {
  return HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic.trim().toLowerCase()));
}

// Derive once per trade page (PBKDF2 over the phrase is not free).
export function deriveTradeKeys(mnemonic: string, chain: UtxoChain, contractIndex: number) {
  const root = seedRoot(mnemonic);
  const path = escrowPath(chain, contractIndex);
  const escrowNode = root.derive(path);
  const payoutNode = root.derive(walletPath(chain === 'bitcoin' ? 'BTC' : 'LTC'));
  const network = networkForChain(chain);
  return {
    path,
    publicKeyHex: hex(escrowNode.publicKey!),
    privateKey: escrowNode.privateKey!,
    payoutAddress: bitcoin.payments.p2wpkh({ pubkey: Buffer.from(payoutNode.publicKey!), network }).address!,
  };
}
export type TradeKeys = ReturnType<typeof deriveTradeKeys>;

const XPUB_VERSIONS = [
  { public: 0x0488b21e, private: 0x0488ade4 }, // xpub
  { public: 0x043587cf, private: 0x04358394 }, // tpub
  { public: 0x019da462, private: 0x019d9cfe }, // Ltub
];

export function platformPubkeyFromPin(chain: UtxoChain, contractIndex: number): string {
  const pin = pinnedFor(chain);
  if (!pin) fail('escrow_not_configured', 'escrow is not configured in this build — do not fund.');
  for (const versions of XPUB_VERSIONS) {
    let node: HDKey;
    try {
      node = HDKey.fromExtendedKey(pin!.platformXpub, versions);
    } catch {
      continue;
    }
    if (node.privateKey) fail('platform_key', 'pinned platform key is not a public key');
    return hex(node.deriveChild(contractIndex).publicKey!);
  }
  return fail('platform_key', 'pinned platform key could not be read');
}

export function reconstructEscrow(chain: UtxoChain, keys: [string, string, string]) {
  const network = networkForChain(chain);
  const sorted = keys.map((k) => Buffer.from(k, 'hex')).sort(Buffer.compare);
  const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: sorted, network });
  const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });
  return { address: p2wsh.address!, witnessScriptHex: p2ms.output!.toString('hex'), outputScript: p2wsh.output! };
}

export interface SetupInput {
  chain: UtxoChain; contractIndex: number; myParty: Party; mine: TradeKeys;
  keys: EscrowKeysView; escrowAddress: string; witnessScriptHex: string | null;
}

// Before funding (Rule 5) and before every signature.
export function verifyEscrowSetup(input: SetupInput) {
  const { chain, keys } = input;
  if (!keys.vendor || !keys.customer || !keys.platform) fail('keys_missing', 'the escrow keys are incomplete.');
  if (keys.platform!.toLowerCase() !== platformPubkeyFromPin(chain, input.contractIndex)) {
    fail('platform_key', "the platform key for this trade does not match the one built into this site.");
  }
  if (keys[input.myParty]!.toLowerCase() !== input.mine.publicKeyHex) fail('own_key', 'your escrow key on the server is not the one your wallet derives.');
  if (keys[`${input.myParty}_payout`] !== input.mine.payoutAddress) fail('own_payout_address', 'your payout address on the server is not your wallet address.');
  const other: Party = input.myParty === 'vendor' ? 'customer' : 'vendor';
  const otherPayout = keys[`${other}_payout`];
  if (!otherPayout || !isValidUtxoAddress(otherPayout, chain)) fail('counterparty_payout_address', "the counterparty's payout address is invalid.");
  const rebuilt = reconstructEscrow(chain, [keys.vendor!, keys.customer!, keys.platform!]);
  if (rebuilt.address !== input.escrowAddress) fail('escrow_address', 'the escrow address does not match the three keys.');
  if (input.witnessScriptHex && rebuilt.witnessScriptHex !== input.witnessScriptHex.toLowerCase()) fail('escrow_address', 'the escrow script does not match the three keys.');
  return rebuilt;
}

export interface ProposalContract {
  state: string; crypto_side: Party; amount: string; fee_amount: string; network_reserve: string;
}

export interface VerifiedOutput { address: string; value: bigint; role: 'buyer' | 'fee' | 'change' | 'refund' }

export function verifyProposal(input: SetupInput & { purpose: 'release' | 'refund'; psbtBase64: string; contract: ProposalContract }) {
  const { chain, purpose, contract, keys } = input;
  const network = networkForChain(chain);
  const escrow = verifyEscrowSetup(input);
  const funder = contract.crypto_side;
  const buyer: Party = funder === 'vendor' ? 'customer' : 'vendor';
  const buyerPayout = keys[`${buyer}_payout`]!;
  const funderPayout = keys[`${funder}_payout`]!;
  if (buyerPayout === funderPayout) fail('payout_addresses', 'both parties have the same payout address.');

  // §8A: the fee is charged on release and on a DISPUTED refund; a mutual
  // or stranded-coin refund carries no fee.
  const chargeFee = purpose === 'release' || contract.state === 'disputed';
  const fee = chargeFee ? BigInt(contract.fee_amount) : 0n;
  const feeAddress = pinnedFor(chain)!.feeAddress;

  let psbt: bitcoin.Psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(input.psbtBase64, { network });
  } catch {
    return fail('psbt', 'the transaction could not be read.');
  }
  if (psbt.locktime !== 0) fail('locktime', 'the transaction is time-locked.');

  const knownKeys = new Set([keys.vendor!, keys.customer!, keys.platform!].map((k) => k.toLowerCase()));
  let totalIn = 0n;
  psbt.data.inputs.forEach((inp, i) => {
    const txIn = psbt.txInputs[i]!;
    if (!inp.nonWitnessUtxo) fail('input', 'an input is missing its previous transaction.');
    const prev = bitcoin.Transaction.fromBuffer(inp.nonWitnessUtxo!);
    if (!prev.getHash().equals(txIn.hash)) fail('input', 'an input does not match its previous transaction.');
    const out = prev.outs[txIn.index];
    if (!out || !out.script.equals(escrow.outputScript)) fail('input', 'an input does not come from this escrow.');
    if (!inp.witnessScript || inp.witnessScript.toString('hex') !== escrow.witnessScriptHex) fail('input', 'unexpected escrow script.');
    if (inp.sighashType !== undefined && inp.sighashType !== bitcoin.Transaction.SIGHASH_ALL) fail('sighash', 'unexpected signature type.');
    for (const ps of inp.partialSig ?? []) {
      if (ps.signature[ps.signature.length - 1] !== bitcoin.Transaction.SIGHASH_ALL) fail('sighash', 'a signature is not SIGHASH_ALL.');
      if (!knownKeys.has(hex(ps.pubkey))) fail('signature', 'a signature is from an unknown key.');
    }
    totalIn += BigInt(out!.value);
  });

  const outputs = psbt.txOutputs.map((o) => ({ address: bitcoin.address.fromOutputScript(o.script, network), value: BigInt(o.value), script: o.script }));
  const verified: VerifiedOutput[] = [];
  const take = (address: string) => {
    const i = outputs.findIndex((o) => o.address === address);
    return i === -1 ? null : outputs.splice(i, 1)[0]!;
  };

  if (fee > 0n) {
    const f = take(feeAddress);
    if (!f || f.value !== fee) fail('fee_output', 'the platform fee output is wrong.');
    verified.push({ address: feeAddress, value: fee, role: 'fee' });
  }
  if (purpose === 'release') {
    const b = take(buyerPayout);
    if (!b || b.value !== BigInt(contract.amount)) fail('recipient', "the buyer's output is not exactly the trade amount to the buyer's address.");
    verified.push({ address: buyerPayout, value: b!.value, role: 'buyer' });
    const change = take(funderPayout);
    if (change) {
      if (change.value < DUST[chain]) fail('change', 'the change output is below dust.');
      verified.push({ address: funderPayout, value: change.value, role: 'change' });
    }
  } else {
    const r = take(funderPayout);
    if (!r || r.value < DUST[chain]) fail('recipient', "the refund doesn't go to the funder's address.");
    verified.push({ address: funderPayout, value: r!.value, role: 'refund' });
  }
  if (outputs.length > 0) fail('extra_output', 'the transaction pays an address that is not part of this trade.');

  const totalOut = verified.reduce((s, o) => s + o.value, 0n);
  const networkFee = totalIn - totalOut;
  const vsize = OVERHEAD_VB + BigInt(psbt.inputCount) * ESCROW_INPUT_VB
    + psbt.txOutputs.reduce((s, o) => s + 9n + BigInt(o.script.length), 0n);
  if (networkFee < vsize * MIN_RELAY[chain]) fail('network_fee', 'the network fee is too low to confirm.');
  const reserve = BigInt(contract.network_reserve);
  const cap = purpose === 'release' && reserve > 0n ? reserve + DUST[chain] : (reserve + DUST[chain] > vsize * MAX_RATE[chain] ? reserve + DUST[chain] : vsize * MAX_RATE[chain]);
  if (networkFee > cap) fail('network_fee', 'the network fee is higher than the reserve allows.');

  return { outputs: verified, networkFee, totalIn };
}

export function signProposal(psbtBase64: string, chain: UtxoChain, mine: TradeKeys): string {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: networkForChain(chain) });
  const signer = {
    publicKey: Buffer.from(mine.publicKeyHex, 'hex'),
    sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, mine.privateKey)),
  };
  psbt.signAllInputs(signer, [bitcoin.Transaction.SIGHASH_ALL]);
  return psbt.toBase64();
}
