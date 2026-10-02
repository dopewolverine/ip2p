import { entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// Spec §3 / §5.1 - 128 bits of crypto.getRandomValues entropy, explicitly,
// never the library's own convenience generator and never Math.random.
export function generateMnemonic(): string {
  const entropy = new Uint8Array(16);
  crypto.getRandomValues(entropy);
  return entropyToMnemonic(entropy, wordlist);
}

export function isValidMnemonic(phrase: string): boolean {
  return validateMnemonic(phrase.trim().toLowerCase(), wordlist);
}
