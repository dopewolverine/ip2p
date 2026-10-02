import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory from 'ecpair';
import { HDNodeWallet, Mnemonic } from 'ethers';
// @ts-ignore - see the note in walletDerivation.ts about tronweb's types.
import TronWeb from 'tronweb';

import { networkForChain, walletPath } from '../network';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);


export type TxFormat = 'psbt_base64' | 'evm_tx' | 'tron_tx';
export type WalletAsset = 'BTC' | 'LTC' | 'ETH' | 'USDT_ERC20' | 'USDC_ERC20' | 'USDT_TRC20';

// Spec P1 §7.1 step 5 - signing happens entirely in the browser. The
// private key is re-derived from the in-memory mnemonic each time
// (never itself persisted) using the exact same paths as
// walletDerivation.ts - a mismatch here would mean signing with a key
// that doesn't control the address the transaction claims to spend from.
export async function signTransaction(
  asset: WalletAsset,
  format: TxFormat,
  data: unknown,
  mnemonicPhrase: string
): Promise<string> {
  const phrase = mnemonicPhrase.trim().toLowerCase();

  if (format === 'psbt_base64') {
    const seed = mnemonicToSeedSync(phrase);
    const root = HDKey.fromMasterSeed(seed);
    const path = walletPath(asset === 'BTC' ? 'BTC' : 'LTC');
    const network = networkForChain(asset === 'BTC' ? 'bitcoin' : 'litecoin');
    const node = root.derive(path);
    const keyPair = ECPair.fromPrivateKey(Buffer.from(node.privateKey!), { network });

    const psbt = bitcoin.Psbt.fromBase64(data as string, { network });
    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  }

  if (format === 'evm_tx') {
    const mnemonicObj = Mnemonic.fromPhrase(phrase);
    const wallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/60'/0'/0/0");

    // Backend sent bigint fields as strings (JSON can't carry bigint) -
    // convert them back before handing this to ethers.
    const raw = data as Record<string, any>;
    const tx = {
      to: raw.to,
      data: raw.data,
      value: raw.value !== undefined ? BigInt(raw.value) : undefined,
      chainId: raw.chainId !== undefined ? BigInt(raw.chainId) : undefined,
      nonce: raw.nonce,
      maxFeePerGas: raw.maxFeePerGas !== undefined ? BigInt(raw.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: raw.maxPriorityFeePerGas !== undefined ? BigInt(raw.maxPriorityFeePerGas) : undefined,
      gasLimit: raw.gasLimit !== undefined ? BigInt(raw.gasLimit) : undefined,
      type: raw.type,
    };

    return wallet.signTransaction(tx);
  }

  if (format === 'tron_tx') {
    const mnemonicObj = Mnemonic.fromPhrase(phrase);
    const tronWallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/195'/0'/0/0");
    const privateKeyHex = tronWallet.privateKey.slice(2);

    // tronweb signs the transaction object directly (not a hex string) -
    // the caller sends the returned JSON straight to /wallet/broadcast.
    // TronWeb requires a fullHost at construction even though .trx.sign()
    // itself is a local operation (signs with the private key, no network
    // call) - the URL here is never actually used for this call.
    const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' });
    const signed = await tronWeb.trx.sign(data, privateKeyHex);
    return JSON.stringify(signed);
  }

  throw new Error(`unknown tx format: ${format}`);
}
