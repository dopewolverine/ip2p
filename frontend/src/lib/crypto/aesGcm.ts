// Spec §3.2 - fresh random 12-byte IV on every encryption, never reused,
// never derived. AAD binds the blob to its owner; see the note below.

export function randomIv(): Uint8Array {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  return iv;
}

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

// AAD design note: spec §3.2 says "pass the user id as AES-GCM associated
// data," but the blob is encrypted client-side BEFORE the server assigns
// a user id (registration's crypto step is entirely offline - spec §5.1
// step 2 runs before step 3's POST). Username is the value actually
// available at encryption time, is unique, and - with no username-change
// feature in P0 - stays constant for the account's life, so it serves the
// same owner-binding purpose. Normalized (trimmed, lowercased) so case
// differences at login can't produce a mismatch.
export function ownerAad(username: string): Uint8Array {
  return new TextEncoder().encode(username.trim().toLowerCase());
}

// TypeScript's DOM lib types crypto.subtle's params as BufferSource, which
// a plain Uint8Array<ArrayBufferLike> doesn't structurally satisfy under
// newer TS versions (only Uint8Array<ArrayBuffer> does) - a type-checker
// strictness change, not a real runtime distinction. Every value passed
// into crypto.subtle below is cast accordingly; the bytes themselves are
// identical either way.
export async function encryptBlob(
  plaintext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
    cryptoKey,
    plaintext as BufferSource
  );
  return new Uint8Array(ciphertext); // WebCrypto appends the 16-byte auth tag
}

export async function decryptBlob(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
    cryptoKey,
    ciphertext as BufferSource
  );
  return new Uint8Array(plaintext);
}
