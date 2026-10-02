import type { PoolClient } from 'pg';
import { decryptTotpSecret, matchTotpStep } from './totp';
import { hashRecoveryCode } from './recoveryCodes';

// One per-account failure counter for every second-factor
// check (login TOTP, login recovery code, password reset, 2FA disable,
// account deletion). Previously the budget was per challenge token, and a
// fresh token was one password away - roughly fifty guesses per fifteen
// minutes per account. Now it is five, whichever door they come through.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; resetAt: number }>();

export function secondFactorLocked(userId: string): boolean {
  const b = failures.get(userId);
  return !!b && b.resetAt > Date.now() && b.count >= MAX_FAILURES;
}

function recordFailure(userId: string): void {
  const now = Date.now();
  const b = failures.get(userId);
  if (!b || b.resetAt <= now) failures.set(userId, { count: 1, resetAt: now + WINDOW_MS });
  else b.count += 1;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of failures) if (b.resetAt <= now) failures.delete(k);
}, 60_000).unref();

export type SecondFactorResult =
  | { ok: true; via: 'totp' | 'recovery_code' }
  | { ok: false; reason: 'locked' | 'invalid_code' | 'totp_not_enabled' };

// Must be called inside an open transaction on `db`: it locks the user
// row, and the TOTP time-step / recovery-code consumption commit together
// with whatever the caller does next.
export async function verifySecondFactor(
  db: PoolClient,
  userId: string,
  input: { code?: string | null; recoveryCode?: string | null }
): Promise<SecondFactorResult> {
  if (secondFactorLocked(userId)) return { ok: false, reason: 'locked' };

  const { rows } = await db.query(
    `SELECT totp_secret_enc, totp_enabled, totp_last_step FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  const user = rows[0];
  if (!user || !user.totp_enabled || !user.totp_secret_enc) return { ok: false, reason: 'totp_not_enabled' };

  if (input.code && /^\d{6}$/.test(input.code)) {
    const secret = decryptTotpSecret(Buffer.from(user.totp_secret_enc));
    const step = matchTotpStep(secret, input.code);
    const lastStep = user.totp_last_step === null ? null : Number(user.totp_last_step);
    // Replay protection: a code is good for one use, not for its whole
    // 90-second validity window.
    if (step !== null && (lastStep === null || step > lastStep)) {
      await db.query(`UPDATE users SET totp_last_step = $1 WHERE id = $2`, [step, userId]);
      failures.delete(userId);
      return { ok: true, via: 'totp' };
    }
  } else if (input.recoveryCode) {
    const { rows: codeRows } = await db.query(
      `SELECT id FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL FOR UPDATE`,
      [userId, hashRecoveryCode(input.recoveryCode)]
    );
    if (codeRows[0]) {
      await db.query(`UPDATE recovery_codes SET used_at = now() WHERE id = $1`, [codeRows[0].id]);
      // P0 §9: recovery-code use is a 2FA change - reputation hold.
      await db.query(
        `UPDATE users SET reputation_held_until = now() + interval '48 hours', updated_at = now() WHERE id = $1`,
        [userId]
      );
      failures.delete(userId);
      return { ok: true, via: 'recovery_code' };
    }
  }

  recordFailure(userId);
  return { ok: false, reason: 'invalid_code' };
}
