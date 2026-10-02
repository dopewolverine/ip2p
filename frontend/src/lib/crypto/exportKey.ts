import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory from 'ecpair';
import { HDNodeWallet, Mnemonic } from 'ethers';

import { networkForChain, walletPath } from '../network';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);


export type WalletAsset = 'BTC' | 'LTC' | 'ETH' | 'USDT_ERC20' | 'USDC_ERC20' | 'USDT_TRC20';

// Spec P1 §8 - the standard import format for each chain: WIF for
// Bitcoin/Litecoin (what Electrum expects), hex for Ethereum/Tron (what
// MetaMask/TronLink expect). Entirely client-side - nothing here is ever
// sent to the server; POST /wallet/export (called separately, before
// this) carries only the asset code, never the key.
export function exportPrivateKey(asset: WalletAsset, mnemonicPhrase: string): string {
  const phrase = mnemonicPhrase.trim().toLowerCase();

  if (asset === 'BTC' || asset === 'LTC') {
    const seed = mnemonicToSeedSync(phrase);
    const root = HDKey.fromMasterSeed(seed);
    const path = walletPath(asset === 'BTC' ? 'BTC' : 'LTC');
    const network = networkForChain(asset === 'BTC' ? 'bitcoin' : 'litecoin');
    const node = root.derive(path);
    const keyPair = ECPair.fromPrivateKey(Buffer.from(node.privateKey!), { network });
    return keyPair.toWIF();
  }

  // ETH, USDT_ERC20, USDC_ERC20 share one Ethereum key; USDT_TRC20 uses
  // the Tron path but the same hex-private-key format.
  const mnemonicObj = Mnemonic.fromPhrase(phrase);
  const path = asset === 'USDT_TRC20' ? "m/44'/195'/0'/0/0" : "m/44'/60'/0'/0/0";
  const wallet = HDNodeWallet.fromMnemonic(mnemonicObj, path);
  return wallet.privateKey; // 0x-prefixed hex — accepted by MetaMask and TronLink alike
}
