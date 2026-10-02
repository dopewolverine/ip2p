import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import { env } from '../config/env';

// Spec §9: secret encrypted at rest with an application key held outside
// the database. Layout: iv(12) | authTag(16) | ciphertext.
export function encryptTotpSecret(secretBase32: string, key: Buffer = env.appEncKey): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptTotpSecret(enc: Buffer, key: Buffer = env.appEncKey): string {
  const iv = enc.subarray(0, 12);
  const tag = enc.subarray(12, 28);
  const ciphertext = enc.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// RFC 6238, 30s step, ±1 step tolerance (P0 §3).
authenticator.options = { window: 1, step: 30 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpProvisioningUri(username: string, secretBase32: string): string {
  return authenticator.keyuri(username, 'iP2P', secretBase32);
}

// Returns the absolute time-step the code matched, so callers
// can refuse a code whose step was already used (replay protection).
export function matchTotpStep(secretBase32: string, code: string): number | null {
  const delta = authenticator.checkDelta(code, secretBase32);
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / 30) + delta;
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  return matchTotpStep(secretBase32, code) !== null;
}
