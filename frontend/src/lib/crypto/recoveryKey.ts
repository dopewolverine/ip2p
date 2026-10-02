import { Mnemonic, HDNodeWallet } from 'ethers';

// Spec §7A.1 - an ordinary secp256k1 keypair at Ethereum account index
// 100, deliberately far from any wallet account. Holds no funds; only
// proves possession of the seed. Uses ethers end to end (derivation and
// signing) so no separate cryptography is introduced.
const RECOVERY_PATH = "m/44'/60'/100'/0/0";

export function deriveRecoveryWallet(mnemonicPhrase: string): HDNodeWallet {
  const mnemonic = Mnemonic.fromPhrase(mnemonicPhrase.trim().toLowerCase());
  return HDNodeWallet.fromMnemonic(mnemonic, RECOVERY_PATH);
}

export function deriveRecoveryAddress(mnemonicPhrase: string): string {
  return deriveRecoveryWallet(mnemonicPhrase).address;
}

// Spec §3.2 - always signMessage/verifyMessage (EIP-191), never a
// hand-rolled hash-and-sign. signMessage handles the prefix internally.
export async function signRecoveryNonce(mnemonicPhrase: string, nonce: Uint8Array): Promise<string> {
  const wallet = deriveRecoveryWallet(mnemonicPhrase);
  return wallet.signMessage(nonce);
}
