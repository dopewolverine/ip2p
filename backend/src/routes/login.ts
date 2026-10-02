import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { verifyAuthVerifier, burnVerifierCheck, fakeSalt, fakeServerSalt, hashIp, sha256Hex } from '../lib/crypto';
import { RECOMMENDED_KDF_PARAMS } from '../lib/kdfParams';
import { createSession, cancelPendingDeletionIfNeeded } from '../lib/sessions';
import { setSessionCookie, clearSessionCookie } from '../lib/sessionCookie';
import { createChallengeToken, verifyChallengeToken, consumeChallengeToken } from '../lib/challengeToken';
import { verifySecondFactor } from '../lib/secondFactor';
import { reactivateVendorOffers } from '../marketplace/offerAutoPause';
import { notifyIfNewDevice } from '../lib/securityNotifications';
import { emitNotificationStandalone } from '../lib/notifications';
import { logAuthEvent } from '../lib/authEvents';
import { rateLimit } from '../middleware/rateLimit';
import { requireSession } from '../middleware/auth';

export const loginRouter = Router();

// Pending_seed_confirmation is NOT blocked at login. "If the
// browser closes before confirmation ... the user logs back in, the phrase
// is decrypted and shown again, and they confirm." Blocking it here left
// those accounts permanently stuck. The session middleware still confines
// a pending account to confirm-seed / delete / me / logout.
const BLOCKED_STATUSES = new Set(['disabled', 'deleted']);

// Fetches the current wallet_blob so the client can decrypt right after
// authenticating. username travels too, so the client can rebuild the
// AES-GCM AAD regardless of which identifier it logged in with.
async function currentBlobPayload(userId: string) {
  const { rows } = await pool.query(
    `SELECT u.username, u.status, wb.blob, wb.iv, wb.salt, wb.kdf_params
     FROM users u
     JOIN wallet_blobs wb ON wb.user_id = u.id AND wb.status = 'current'
     WHERE u.id = $1`,
    [userId]
  );
  const row = rows[0];
  return {
    username: row.username,
    account_status: row.status,
    blob: Buffer.from(row.blob).toString('base64'),
    iv: Buffer.from(row.iv).toString('base64'),
    salt: Buffer.from(row.salt).toString('base64'),
    kdf_params: row.kdf_params,
  };
}

async function completeLogin(req: Request, res: Response, userId: string, eventType: 'login_success' | 'totp_success' | 'recovery_code_used') {
  const ipHash = hashIp(req.ip ?? '', env.serverSecret);
  const userAgent = req.get('user-agent') ?? null;
  const token = await createSession(userId, ipHash, userAgent);
  setSessionCookie(res, token);
  await cancelPendingDeletionIfNeeded(userId);
  await reactivateVendorOffers(userId);
  await notifyIfNewDevice(userId, userAgent);
  await logAuthEvent({ userId, eventType, ipHash, userAgent });
  res.json({ status: 'ok', ...(await currentBlobPayload(userId)) });
}

loginRouter.post(
  '/login/salt',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keyFn: (req) => `login_salt:${req.ip}` }),
  async (req, res) => {
    const parsed = z.object({ username_or_email: z.string().min(1).max(254) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const identifier = parsed.data.username_or_email;

    const { rows } = await pool.query(
      `SELECT wb.salt, wb.kdf_params
       FROM users u
       JOIN wallet_blobs wb ON wb.user_id = u.id AND wb.status = 'current'
       WHERE u.username = $1 OR u.email = $1`,
      [identifier]
    );

    // Privacy: the response never includes the username, so it can't reveal
    // which username an email address belongs to.
    if (rows.length === 0) {
      return res.json({
        salt: fakeSalt(identifier, env.serverSecret).toString('base64'),
        kdf_params: RECOMMENDED_KDF_PARAMS,
      });
    }

    res.json({
      salt: Buffer.from(rows[0].salt).toString('base64'),
      kdf_params: rows[0].kdf_params,
    });
  }
);

const loginSchema = z.object({
  username_or_email: z.string().min(1).max(254),
  verifier: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

loginRouter.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `login_ip:${req.ip}` }),
  rateLimit({
    windowMs: 15 * 60 * 1000, max: 10,
    keyFn: (req) => `login_acct:${String(req.body?.username_or_email ?? '').toLowerCase()}`,
  }),
  async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const { username_or_email } = parsed.data;
    const verifier = Buffer.from(parsed.data.verifier, 'base64');
    const ipHash = hashIp(req.ip ?? '', env.serverSecret);
    const userAgent = req.get('user-agent') ?? null;

    if (verifier.length !== 32) {
      await logAuthEvent({ eventType: 'login_failed', ipHash, userAgent });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const { rows } = await pool.query(
      `SELECT id, auth_hash, server_salt, totp_enabled, status FROM users WHERE username = $1 OR email = $1`,
      [username_or_email]
    );
    const user = rows[0];

    const ok = user
      ? await verifyAuthVerifier(verifier, Buffer.from(user.server_salt), user.auth_hash)
      : await burnVerifierCheck(verifier, fakeServerSalt(username_or_email, env.serverSecret));

    if (!ok) {
      await logAuthEvent({ userId: user?.id ?? null, eventType: 'login_failed', ipHash, userAgent });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    if (BLOCKED_STATUSES.has(user.status)) {
      await logAuthEvent({ userId: user.id, eventType: 'login_failed', ipHash, userAgent, metadata: { reason: 'inactive' } });
      return res.status(403).json({ error: 'account_not_active' });
    }

    if (user.totp_enabled) {
      return res.json({ totp_required: true, challenge_token: createChallengeToken(user.id) });
    }

    await completeLogin(req, res, user.id, 'login_success');
  }
);

const secondFactorSchema = z.object({
  challenge_token: z.string().min(1).max(1000),
  code: z.string().min(1).max(20),
});

async function secondFactorLogin(req: Request, res: Response, mode: 'totp' | 'recovery_code') {
  const parsed = secondFactorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  if (mode === 'totp' && !/^\d{6}$/.test(parsed.data.code)) return res.status(400).json({ error: 'invalid_input' });

  const ipHash = hashIp(req.ip ?? '', env.serverSecret);
  const userAgent = req.get('user-agent') ?? null;

  const challenge = verifyChallengeToken(parsed.data.challenge_token);
  if (!challenge) return res.status(401).json({ error: 'invalid_or_expired_challenge' });
  const { userId } = challenge;

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT status FROM users WHERE id = $1`, [userId]);
    if (!rows[0] || BLOCKED_STATUSES.has(rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'account_not_active' });
    }
    result = await verifySecondFactor(client, userId, mode === 'totp'
      ? { code: parsed.data.code }
      : { recoveryCode: parsed.data.code });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (!result.ok) {
    await logAuthEvent({ userId, eventType: 'totp_failed', ipHash, userAgent, metadata: { via: mode, reason: result.reason } });
    if (result.reason === 'locked') return res.status(429).json({ error: 'too_many_attempts' });
    return res.status(401).json({ error: 'invalid_code' });
  }

  consumeChallengeToken(challenge.jti);
  if (result.via === 'recovery_code') {
    await emitNotificationStandalone({ userId, type: 'recovery_code_used', priority: 'security', dedupeKey: `${Date.now()}` });
  }
  await completeLogin(req, res, userId, result.via === 'recovery_code' ? 'recovery_code_used' : 'totp_success');
}

loginRouter.post(
  '/login/totp',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyFn: (req) => `totp_ip:${req.ip}` }),
  (req, res) => secondFactorLogin(req, res, 'totp')
);

loginRouter.post(
  '/login/recovery-code',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyFn: (req) => `recovery_code_ip:${req.ip}` }),
  (req, res) => secondFactorLogin(req, res, 'recovery_code')
);

loginRouter.post('/logout', requireSession, async (req, res) => {
  const token = req.cookies?.session;
  if (token) {
    await pool.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, [sha256Hex(token)]);
  }
  clearSessionCookie(res);
  await logAuthEvent({ userId: req.user!.id, eventType: 'logout' });
  res.json({ status: 'ok' });
});
