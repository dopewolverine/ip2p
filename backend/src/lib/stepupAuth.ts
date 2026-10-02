import { pool } from '../db/pool';
import { env } from '../config/env';
import { verifyAuthVerifier, hashIp } from './crypto';
import { logAuthEvent } from './authEvents';
import { Request } from 'express';

// Spec §3.1.1 / §10 - step-up is inline, never a separate endpoint or an
// elevated-session token. Every action that needs it (2FA enable/disable,
// account deletion, password change) calls verifyStepup() directly inside
// its own handler, with the verifier travelling in that same request body.
//
// Failures share ONE per-account counter across every step-up-gated action.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failureBuckets = new Map<string, { count: number; resetAt: number }>();

export function isStepupLocked(userId: string): boolean {
  const bucket = failureBuckets.get(userId);
  if (!bucket || bucket.resetAt <= Date.now()) return false;
  return bucket.count >= MAX_FAILURES;
}

function recordFailure(userId: string): void {
  const now = Date.now();
  const bucket = failureBuckets.get(userId);
  if (!bucket || bucket.resetAt <= now) {
    failureBuckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    bucket.count += 1;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of failureBuckets) {
    if (bucket.resetAt <= now) failureBuckets.delete(key);
  }
}, 60_000).unref();

export async function verifyStepup(req: Request, userId: string, verifierB64: string): Promise<boolean> {
  const ipHash = hashIp(req.ip ?? '', env.serverSecret);
  const userAgent = req.get('user-agent') ?? null;

  if (isStepupLocked(userId)) {
    await logAuthEvent({ userId, eventType: 'stepup_failed', ipHash, userAgent, metadata: { locked: true } });
    return false;
  }

  const verifier = Buffer.from(verifierB64, 'base64');
  if (verifier.length !== 32) {
    recordFailure(userId);
    await logAuthEvent({ userId, eventType: 'stepup_failed', ipHash, userAgent });
    return false;
  }

  const { rows } = await pool.query('SELECT auth_hash, server_salt FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  const ok = user
    ? await verifyAuthVerifier(verifier, Buffer.from(user.server_salt), user.auth_hash)
    : false;

  if (!ok) {
    recordFailure(userId);
    await logAuthEvent({ userId, eventType: 'stepup_failed', ipHash, userAgent });
    return false;
  }

  return true;
}
