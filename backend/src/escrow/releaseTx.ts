import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { networkFor, UtxoChain } from '../chain/networks';

bitcoin.initEccLib(ecc);

// P2 §4A.4 dust thresholds (spec values).
export const DUST: Record<UtxoChain, bigint> = { bitcoin: 546n, litecoin: 5460n };
export const MIN_RELAY_RATE: Record<UtxoChain, bigint> = { bitcoin: 1n, litecoin: 10n };
export const MAX_PROPOSAL_RATE: Record<UtxoChain, bigint> = { bitcoin: 500n, litecoin: 1000n };
const RESERVE_RATE: Record<UtxoChain, { min: bigint; max: bigint; fallback: bigint }> = {
  bitcoin: { min: 5n, max: 150n, fallback: 30n },
  litecoin: { min: 10n, max: 200n, fallback: 20n },
};

const OVERHEAD_VB = 11n;
export const ESCROW_INPUT_VB = 105n; // 2-of-3 P2WSH input incl. witness, rounded up
// One escrow input and three outputs of the largest standard size.
export const RESERVE_VSIZE = OVERHEAD_VB + ESCROW_INPUT_VB + 3n * 43n;

export function outputVbytes(script: Buffer): bigint {
  return 9n + BigInt(script.length); // 8-byte value + 1-byte length + script
}

export function estimateVsize(inputCount: number, outputScripts: Buffer[]): bigint {
  return OVERHEAD_VB + BigInt(inputCount) * ESCROW_INPUT_VB + outputScripts.reduce((s, sc) => s + outputVbytes(sc), 0n);
}

// P2 §4.2 required funding of exactly
// amount + fee, while §4.3 says the network fee is borne by the crypto
// side. Both cannot hold: an exactly-funded escrow left nothing for the
// miner and the release could never broadcast. The funder now also funds
// this reserve, snapshotted when the escrow address is created. The
// buyer's amount and the platform fee are never touched; whatever the
// network fee doesn't use returns to the funder as change.
export function networkReserveFor(chain: UtxoChain, fastRate: bigint | null): bigint {
  const b = RESERVE_RATE[chain];
  let rate = fastRate === null ? b.fallback : fastRate * 2n;
  if (rate < b.min) rate = b.min;
  if (rate > b.max) rate = b.max;
  return RESERVE_VSIZE * rate;
}

export interface EscrowUtxo { txid: string; vout: number; value: bigint; rawTxHex: string }

export interface ProposalSpec {
  chain: UtxoChain;
  purpose: 'release' | 'refund';
  witnessScriptHex: string;
  utxos: EscrowUtxo[];
  amount: bigint;
  feeAmount: bigint; // 0 = no fee output (not charged, or below dust at creation)
  buyerAddress: string;
  funderAddress: string;
  feeAddress: string | null;
  feeRate: bigint;
}

export interface ProposalOutput { address: string; value: bigint; role: 'buyer' | 'fee' | 'change' | 'refund' }

// P2 §4.3: the server builds ONE unsigned PSBT. Both signers verify it
// (§4A.1) and sign that same transaction, so their signatures always combine.
export function buildProposalPsbt(spec: ProposalSpec): { psbtBase64: string; networkFee: bigint; outputs: ProposalOutput[] } {
  const network = networkFor(spec.chain);
  const witnessScript = Buffer.from(spec.witnessScriptHex, 'hex');
  const escrowOutputScript = bitcoin.payments.p2wsh({ redeem: { output: witnessScript }, network }).output!;
  if (spec.utxos.length === 0) throw new Error('no_escrow_utxos');

  const psbt = new bitcoin.Psbt({ network });
  let totalIn = 0n;
  for (const u of spec.utxos) {
    const prev = bitcoin.Transaction.fromHex(u.rawTxHex);
    if (prev.getId() !== u.txid) throw new Error('raw_tx_mismatch');
    const out = prev.outs[u.vout];
    if (!out || !out.script.equals(escrowOutputScript)) throw new Error('utxo_not_escrow');
    if (BigInt(out.value) !== u.value) throw new Error('utxo_value_mismatch');
    // §4A.3 - the full previous transaction, so every signer can check the amount.
    psbt.addInput({
      hash: u.txid, index: u.vout,
      nonWitnessUtxo: Buffer.from(u.rawTxHex, 'hex'),
      witnessScript,
      sighashType: bitcoin.Transaction.SIGHASH_ALL,
    });
    totalIn += u.value;
  }

  const dust = DUST[spec.chain];
  const minRate = MIN_RELAY_RATE[spec.chain];
  const rate = spec.feeRate < minRate ? minRate : spec.feeRate;
  const script = (a: string) => bitcoin.address.toOutputScript(a, network);
  const fee = spec.feeAmount;
  if (fee > 0n && !spec.feeAddress) throw new Error('fee_address_missing');
  if (fee > 0n && fee < dust) throw new Error('fee_below_dust');

  const outputs: ProposalOutput[] = [];
  if (spec.purpose === 'release') {
    const base = spec.amount + fee;
    if (totalIn < base) throw new Error('escrow_underfunded');
    outputs.push({ address: spec.buyerAddress, value: spec.amount, role: 'buyer' });
    if (fee > 0n) outputs.push({ address: spec.feeAddress!, value: fee, role: 'fee' });
    const withChange = [...outputs.map((o) => script(o.address)), script(spec.funderAddress)];
    const change = totalIn - base - estimateVsize(spec.utxos.length, withChange) * rate;
    if (change >= dust) {
      outputs.push({ address: spec.funderAddress, value: change, role: 'change' });
    } else {
      // Leftover below dust goes to the miner - but it must at least pay
      // the minimum relay fee, or the transaction will never propagate.
      const minFee = estimateVsize(spec.utxos.length, outputs.map((o) => script(o.address))) * minRate;
      if (totalIn - base < minFee) throw new Error('insufficient_network_fee');
    }
  } else {
    if (fee > 0n) outputs.push({ address: spec.feeAddress!, value: fee, role: 'fee' });
    const scripts = [...outputs.map((o) => script(o.address)), script(spec.funderAddress)];
    const refund = totalIn - fee - estimateVsize(spec.utxos.length, scripts) * rate;
    if (refund < dust) throw new Error('refund_below_dust');
    outputs.push({ address: spec.funderAddress, value: refund, role: 'refund' });
  }

  for (const o of outputs) psbt.addOutput({ address: o.address, value: Number(o.value) });
  const totalOut = outputs.reduce((s, o) => s + o.value, 0n);
  return { psbtBase64: psbt.toBase64(), networkFee: totalIn - totalOut, outputs };
}

export function unsignedTxHex(psbt: bitcoin.Psbt): string {
  return (psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer }).toBuffer().toString('hex');
}

export function signatureValidator(pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean {
  return ecc.verify(msghash, pubkey, signature);
}
