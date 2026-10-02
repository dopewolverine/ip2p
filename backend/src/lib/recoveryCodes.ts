import { randomBytes } from 'crypto';
import { sha256Hex } from './crypto';

// Spec §9: 10 single-use codes, shown once, stored hashed.
export function generateRecoveryCode(): string {
  const raw = randomBytes(5).toString('hex').toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^A-F0-9]/gi, '').toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return sha256Hex(normalizeRecoveryCode(code));
}
