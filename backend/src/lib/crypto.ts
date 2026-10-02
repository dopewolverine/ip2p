import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import { argon2idAsync } from '@noble/hashes/argon2';

// Server-side verifier hash - P0 §3: Argon2id, m=19456 KiB, t=2, p=1, 32-byte output.
//
// The synchronous argon2id() held Node's single event
// loop for ~0.5s per login (~1s for unknown usernames, which hashed twice),
// so a few login attempts a second froze every other request. The async
// variant from the same audited library yields to the event loop while it
// works and produces byte-identical output, so existing auth_hash values
// stay valid.
const SERVER_KDF = { t: 2, m: 19456, p: 1, dkLen: 32, asyncTick: 10 } as const;

export async function hashAuthVerifier(authVerifier: Buffer, serverSalt: Buffer): Promise<string> {
  const hash = await argon2idAsync(authVerifier, serverSalt, SERVER_KDF);
  return Buffer.from(hash).toString('hex');
}

// Constant-time by construction (acceptance criterion 11c).
export async function verifyAuthVerifier(
  authVerifier: Buffer,
  serverSalt: Buffer,
  storedHashHex: string
): Promise<boolean> {
  const computed = Buffer.from(await hashAuthVerifier(authVerifier, serverSalt), 'hex');
  const stored = Buffer.from(storedHashHex, 'hex');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

// Unknown usernames must cost exactly what a wrong password
// costs. The old path hashed twice (once to build a dummy hash, once to
// compare), which made unknown accounts measurably slower. Now: one hash
// of the submitted verifier, compared against a random value that can
// never match.
const UNMATCHABLE_HASH_HEX = randomBytes(32).toString('hex');
export async function burnVerifierCheck(authVerifier: Buffer, fakeServerSaltBytes: Buffer): Promise<false> {
  await verifyAuthVerifier(authVerifier, fakeServerSaltBytes, UNMATCHABLE_HASH_HEX);
  return false;
}

function pseudoRandomBytes(domain: string, input: string, serverSecret: Buffer, len: number): Buffer {
  return createHmac('sha256', serverSecret)
    .update(`${domain}:${input.toLowerCase()}`)
    .digest()
    .subarray(0, len);
}

// Deterministic fake auth_salt for unknown usernames (spec §6.1).
export function fakeSalt(username: string, serverSecret: Buffer): Buffer {
  return pseudoRandomBytes('auth_salt', username, serverSecret, 16);
}

// Separate deterministic fake server_salt, used only internally at /auth/login
// to keep unknown-user timing on par with wrong-password timing.
export function fakeServerSalt(username: string, serverSecret: Buffer): Buffer {
  return pseudoRandomBytes('server_salt', username, serverSecret, 16);
}

// Deterministic fake recovery nonce for unknown usernames (spec §7A.3).
export function fakeNonce(username: string, serverSecret: Buffer): Buffer {
  return pseudoRandomBytes('recovery_nonce', username, serverSecret, 32);
}

export function hashIp(ip: string, serverSecret: Buffer): string {
  return createHmac('sha256', serverSecret).update(ip).digest('hex');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
