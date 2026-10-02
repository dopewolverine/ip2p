import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { HDNodeWallet, Mnemonic } from 'ethers';
// @ts-ignore - see the note in the backend's chain/tronAdapter.ts about tronweb's types.
import TronWeb from 'tronweb';

import { networkForChain, walletPath } from '../network';

bitcoin.initEccLib(ecc);


export type WalletAsset = 'BTC' | 'LTC' | 'ETH' | 'USDT_ERC20' | 'USDC_ERC20' | 'USDT_TRC20';

export interface DerivedAddress {
  asset: WalletAsset;
  address: string;
}

// Spec P1 §4.1 / core plan §7.1 - the four account-level keys, receiving
// address at index 0 for each. Paths match the backend's canonical table
// in lib/walletAssets.ts exactly; the server re-derives nothing and just
// validates format, but a mismatch here would still mean money sent to
// an address this wallet can't sign for, so treat these paths as fixed.
//
// BTC/LTC derivation requires independent reference-wallet verification
// and a small testnet transfer before use with real funds.
export function deriveAllWalletAddresses(mnemonicPhrase: string): DerivedAddress[] {
  const phrase = mnemonicPhrase.trim().toLowerCase();
  const seed = mnemonicToSeedSync(phrase);
  const root = HDKey.fromMasterSeed(seed);

  const btcNode = root.derive(walletPath('BTC'));
  const btcAddress = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(btcNode.publicKey!),
    network: networkForChain('bitcoin'),
  }).address!;

  const ltcNode = root.derive(walletPath('LTC'));
  const ltcAddress = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(ltcNode.publicKey!),
    network: networkForChain('litecoin'),
  }).address!;

  const mnemonicObj = Mnemonic.fromPhrase(phrase);
  const ethWallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/60'/0'/0/0");
  const ethAddress = ethWallet.address;

  const tronWallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/195'/0'/0/0");
  const tronAddress: string = TronWeb.address.fromPrivateKey(tronWallet.privateKey.slice(2));

  return [
    { asset: 'BTC', address: btcAddress },
    { asset: 'LTC', address: ltcAddress },
    { asset: 'ETH', address: ethAddress },
    { asset: 'USDT_ERC20', address: ethAddress },
    { asset: 'USDC_ERC20', address: ethAddress },
    { asset: 'USDT_TRC20', address: tronAddress },
  ];
}
