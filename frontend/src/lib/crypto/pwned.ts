import { sha1 } from '@noble/hashes/legacy';
import { bytesToHex } from '@noble/hashes/utils';

// P0 §5.3 - reject passwords found in known breaches (Have I Been Pwned),
// using the k-anonymity range API: only the first 5 hex characters of the
// password's SHA-1 leave the browser. Returns null if the service can't be
// reached, so an outage never blocks sign-up.
export async function isPasswordPwned(password: string): Promise<boolean | null> {
  const hash = bytesToHex(sha1(new TextEncoder().encode(password))).toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.split('\n').some((line) => {
      const [s, count] = line.trim().split(':');
      return s === suffix && Number(count) > 0;
    });
  } catch {
    return null;
  }
}

export const PWNED_MESSAGE = 'that password appears in a known data breach — choose a different one.';
