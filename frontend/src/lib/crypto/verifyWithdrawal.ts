import * as bitcoin from 'bitcoinjs-lib';
import { Interface, getAddress } from 'ethers';
// @ts-ignore - see the note in walletDerivation.ts about tronweb's types.
import TronWeb from 'tronweb';
import { networkForChain } from '../network';

// The browser signed whatever unsigned transaction the server
// returned. Anyone holding a stolen session could have swapped the
// recipient. Before signing, the transaction is now checked against what
// the user typed: recipient, amount, token contract, own inputs, fee cap.
export class WithdrawalCheckError extends Error {}
const fail = (m: string): never => { throw new WithdrawalCheckError(m); };

const ERC20 = new Interface(['function transfer(address to, uint256 amount)']);
const TOKEN_CONTRACTS: Record<string, string> = {
  USDT_ERC20: process.env.NEXT_PUBLIC_USDT_ERC20_CONTRACT ?? '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  USDC_ERC20: process.env.NEXT_PUBLIC_USDC_ERC20_CONTRACT ?? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
};
const TRC20_USDT = process.env.NEXT_PUBLIC_USDT_TRC20_CONTRACT ?? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const EVM_CHAIN_ID = BigInt(process.env.NEXT_PUBLIC_EVM_CHAIN_ID ?? '1');
const MAX_EVM_FEE_WEI = 50_000_000_000_000_000n; // 0.05 ETH
const MAX_TRON_FEE_LIMIT = 100_000_000; // 100 TRX, in sun
const MAX_UTXO_RATE = 1000n; // sat/vB

export function verifyWithdrawal(p: {
  asset: string; format: string; data: unknown; to: string; amount: bigint; ownAddress: string;
}): { networkFee: bigint | null } {
  if (p.format === 'psbt_base64') {
    if (p.asset !== 'BTC' && p.asset !== 'LTC') fail('unexpected transaction type.');
    const network = networkForChain(p.asset === 'BTC' ? 'bitcoin' : 'litecoin');
    const psbt = bitcoin.Psbt.fromBase64(String(p.data), { network });
    const own = bitcoin.address.toOutputScript(p.ownAddress, network);
    const dest = bitcoin.address.toOutputScript(p.to, network);
    let totalIn = 0n;
    for (const inp of psbt.data.inputs) {
      if (!inp.witnessUtxo || !Buffer.from(inp.witnessUtxo.script).equals(own)) fail('an input is not from your wallet.');
      totalIn += BigInt(inp.witnessUtxo!.value);
    }
    let toDest = 0n;
    let change = 0n;
    for (const o of psbt.txOutputs) {
      if (o.script.equals(dest)) toDest += BigInt(o.value);
      else if (o.script.equals(own)) change += BigInt(o.value);
      else fail('the transaction pays an address you did not enter.');
    }
    if (toDest !== p.amount) fail('the amount does not match what you entered.');
    const fee = totalIn - toDest - change;
    const vsize = 11n + BigInt(psbt.inputCount) * 68n + BigInt(psbt.txOutputs.length) * 43n;
    if (fee <= 0n || fee > vsize * MAX_UTXO_RATE) fail('the network fee is unreasonable.');
    return { networkFee: fee };
  }

  if (p.format === 'evm_tx') {
    const raw = (p.data ?? {}) as Record<string, any>;
    if (raw.chainId === undefined || BigInt(raw.chainId) !== EVM_CHAIN_ID) fail('wrong network.');
    const fee = BigInt(raw.gasLimit ?? 0) * BigInt(raw.maxFeePerGas ?? raw.gasPrice ?? 0);
    if (fee > MAX_EVM_FEE_WEI) fail('the network fee is unreasonable.');
    if (p.asset === 'ETH') {
      if (getAddress(raw.to) !== getAddress(p.to)) fail('the recipient does not match.');
      if (BigInt(raw.value ?? 0) !== p.amount) fail('the amount does not match.');
      if (raw.data && raw.data !== '0x') fail('unexpected contract call.');
      return { networkFee: fee };
    }
    const token = TOKEN_CONTRACTS[p.asset];
    if (!token) return fail('unsupported asset.');
    if (getAddress(raw.to) !== getAddress(token)) fail('wrong token contract.');
    if (BigInt(raw.value ?? 0) !== 0n) fail('unexpected ETH value on a token transfer.');
    if (String(raw.data).toLowerCase() !== ERC20.encodeFunctionData('transfer', [getAddress(p.to), p.amount]).toLowerCase()) {
      fail('the token transfer does not match what you entered.');
    }
    return { networkFee: fee };
  }

  if (p.format === 'tron_tx') {
    const tx = p.data as any;
    // txID must be the hash of raw_data_hex, and raw_data_hex must encode
    // raw_data - otherwise the displayed fields and the signed bytes differ.
    const txCheck = (TronWeb as any)?.utils?.transaction?.txCheck;
    if (typeof txCheck !== 'function' || !txCheck(tx)) fail('the transaction could not be verified.');
    const c = tx?.raw_data?.contract;
    if (!Array.isArray(c) || c.length !== 1) fail('unexpected transaction shape.');
    const v = c[0]?.parameter?.value ?? {};
    if (TronWeb.address.fromHex(v.owner_address) !== p.ownAddress) fail('the transaction is not from your wallet.');
    if (p.asset !== 'USDT_TRC20') fail('unsupported asset.');
    if (c[0].type !== 'TriggerSmartContract' || TronWeb.address.fromHex(v.contract_address) !== TRC20_USDT) fail('wrong token contract.');
    if (Number(v.call_value ?? 0) !== 0) fail('unexpected TRX value.');
    const toHex = TronWeb.address.toHex(p.to).replace(/^41/, '').toLowerCase().padStart(64, '0');
    const amountHex = p.amount.toString(16).padStart(64, '0');
    if (String(v.data).toLowerCase() !== `a9059cbb${toHex}${amountHex}`) fail('the token transfer does not match what you entered.');
    if (Number(tx.raw_data.fee_limit ?? 0) > MAX_TRON_FEE_LIMIT) fail('the fee limit is unreasonable.');
    return { networkFee: null };
  }

  return fail('unknown transaction format.');
}
