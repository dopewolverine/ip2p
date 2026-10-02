import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { verifyMessage } from 'ethers';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { hashAuthVerifier, hashIp, fakeNonce, randomToken, sha256Hex } from '../lib/crypto';
import { meetsKdfFloor, RECOMMENDED_KDF_PARAMS } from '../lib/kdfParams';
import { createSession, revokeAllSessions, revokeOtherSessions } from '../lib/sessions';
import { setSessionCookie } from '../lib/sessionCookie';
import { logAuthEvent } from '../lib/authEvents';
import { sendEmail } from '../lib/email';
import { rateLimit } from '../middleware/rateLimit';
import { emitNotificationStandalone } from '../lib/notifications';
import { requireSession } from '../middleware/auth';

export const recoverRouter = Router();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECOVERY_GRANT_TTL = "interval '15 minutes'";
const INACTIVE = new Set(['disabled', 'deleted']);

const challengeSchema = z.object({ username: z.string().min(1).max(64) });

recoverRouter.post(
  '/recover/challenge',
  // P0 §7A.3 - 5 per hour per username.
  rateLimit({
    windowMs: 60 * 60 * 1000, max: 5,
    keyFn: (req) => `recover_challenge:${String(req.body?.username ?? '').toLowerCase()}`,
  }),
  async (req, res) => {
    const parsed = challengeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const { username } = parsed.data;
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const ipHash = hashIp(req.ip ?? '', env.serverSecret);
    const userAgent = req.get('user-agent') ?? null;

    const { rows } = await pool.query('SELECT id, status FROM users WHERE username = $1', [username]);
    const user = rows[0];

    // Disabled/deleted accounts get the same fake nonce as unknown ones.
    if (!user || INACTIVE.has(user.status)) {
      const nonce = fakeNonce(username, env.serverSecret);
      await logAuthEvent({ eventType: 'seed_recovery_challenge', ipHash, userAgent, metadata: { username } });
      return res.json({ nonce: nonce.toString('base64'), expires_at: expiresAt.toISOString() });
    }

    const nonce = randomBytes(32);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM recovery_challenges WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
      await client.query(
        `INSERT INTO recovery_challenges (user_id, nonce, expires_at) VALUES ($1, $2, $3)`,
        [user.id, nonce, expiresAt]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await logAuthEvent({ userId: user.id, eventType: 'seed_recovery_challenge', ipHash, userAgent });

    res.json({ nonce: nonce.toString('base64'), expires_at: expiresAt.toISOString() });
  }
);

const verifySchema = z.object({
  username: z.string().min(1).max(64),
  signature: z.string().min(1).max(200),
});

recoverRouter.post(
  '/recover/verify',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `recover_verify_ip:${req.ip}` }),
  async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const ipHash = hashIp(req.ip ?? '', env.serverSecret);
    const userAgent = req.get('user-agent') ?? null;
    const { username, signature } = parsed.data;

    const fail = async (userId?: string | null) => {
      await logAuthEvent({ userId: userId ?? null, eventType: 'seed_recovery_failed', ipHash, userAgent });
      res.status(401).json({ error: 'invalid_recovery_attempt' });
    };

    const { rows: userRows } = await pool.query(
      'SELECT id, recovery_address, email, status FROM users WHERE username = $1',
      [username]
    );
    const user = userRows[0];
    // Bans: disabled or deleted accounts can't use seed recovery to get back in.
    if (!user || !user.recovery_address || INACTIVE.has(user.status)) return fail(user?.id);

    const { rows: challengeRows } = await pool.query(
      `SELECT id, nonce FROM recovery_challenges
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const challenge = challengeRows[0];
    if (!challenge) return fail(user.id);

    // Single use, success or failure (P0 §7A.3). Deleting with RETURNING
    // also stops two concurrent verifications of the same nonce.
    const { rowCount } = await pool.query(`DELETE FROM recovery_challenges WHERE id = $1`, [challenge.id]);
    if (rowCount !== 1) return fail(user.id);

    let recovered: string;
    try {
      recovered = verifyMessage(Buffer.from(challenge.nonce), signature);
    } catch {
      return fail(user.id);
    }

    if (recovered.toLowerCase() !== String(user.recovery_address).toLowerCase()) {
      return fail(user.id);
    }

    await revokeAllSessions(user.id);
    const token = await createSession(user.id, ipHash, userAgent);
    setSessionCookie(res, token);

    // Setting a new password after recovery now
    // needs this single-use grant, which only a successful seed signature
    // produces. Before, /recover/set-blob accepted ANY logged-in session -
    // a stolen session could replace the password and wallet blob without
    // knowing the old password.
    const grant = randomToken(32);
    await pool.query(
      `INSERT INTO recovery_grants (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ${RECOVERY_GRANT_TTL})`,
      [user.id, sha256Hex(grant)]
    );

    await pool.query(
      `UPDATE users SET reputation_held_until = now() + interval '48 hours', updated_at = now() WHERE id = $1`,
      [user.id]
    );

    await logAuthEvent({ userId: user.id, eventType: 'seed_recovery_success', ipHash, userAgent });
    await emitNotificationStandalone({ userId: user.id, type: 'seed_recovery_used', priority: 'security', dedupeKey: `${Date.now()}` });

    if (user.email) {
      await sendEmail(
        user.email,
        'Your iP2P account was recovered with your seed phrase',
        `Your account was just recovered using your seed phrase. All other sessions ` +
          `were signed out, and you'll be prompted to set a new password.\n\n` +
          `If this wasn't you, your seed phrase may be compromised — this is more ` +
          `serious than a password leak, since it also controls your wallets. Move ` +
          `your funds to a new wallet immediately.`
      );
    }

    res.json({ status: 'ok', kdf_params: RECOMMENDED_KDF_PARAMS, recovery_grant: grant });
  }
);

const setBlobSchema = z.object({
  recovery_grant: z.string().min(1).max(200),
  new_verifier: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  new_salt: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  new_iv: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  new_blob: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  new_kdf_params: z.object({
    alg: z.string(), m: z.number(), t: z.number(), p: z.number(), version: z.number().optional(),
  }),
});

recoverRouter.post(
  '/recover/set-blob',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `recover_setblob:${req.user!.id}` }),
  async (req, res) => {
    const parsed = setBlobSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const verifier = Buffer.from(parsed.data.new_verifier, 'base64');
    const salt = Buffer.from(parsed.data.new_salt, 'base64');
    const iv = Buffer.from(parsed.data.new_iv, 'base64');
    const blob = Buffer.from(parsed.data.new_blob, 'base64');

    if (verifier.length !== 32) return res.status(400).json({ error: 'invalid_verifier_length' });
    if (salt.length !== 16) return res.status(400).json({ error: 'invalid_salt_length' });
    if (iv.length !== 12) return res.status(400).json({ error: 'invalid_iv_length' });
    if (!meetsKdfFloor(parsed.data.new_kdf_params)) {
      return res.status(400).json({ error: 'kdf_params_below_floor' });
    }

    const userId = req.user!.id;
    const { rows } = await pool.query('SELECT server_salt FROM users WHERE id = $1', [userId]);
    const authHash = await hashAuthVerifier(verifier, Buffer.from(rows[0].server_salt));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: grantRows } = await client.query(
        `UPDATE recovery_grants SET used_at = now()
         WHERE user_id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > now()
         RETURNING id`,
        [userId, sha256Hex(parsed.data.recovery_grant)]
      );
      if (!grantRows[0]) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'recovery_grant_required', message: 'Recover with your seed phrase again, then set the new password within 15 minutes.' });
      }

      await client.query(
        `UPDATE wallet_blobs SET status = 'archived', archived_at = now()
         WHERE user_id = $1 AND status = 'current'`,
        [userId]
      );

      await client.query(
        `INSERT INTO wallet_blobs (user_id, blob, iv, salt, kdf_params, status)
         VALUES ($1, $2, $3, $4, $5, 'current')`,
        [userId, blob, iv, salt, parsed.data.new_kdf_params]
      );

      await client.query(`UPDATE users SET auth_hash = $1, updated_at = now() WHERE id = $2`, [authHash, userId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await revokeOtherSessions(userId, req.sessionId);
    await logAuthEvent({
      userId, eventType: 'password_set_after_recovery',
      ipHash: hashIp(req.ip ?? '', env.serverSecret), userAgent: req.get('user-agent') ?? null,
    });
    await emitNotificationStandalone({ userId, type: 'password_changed', priority: 'security', dedupeKey: `${Date.now()}` });

    res.json({ status: 'ok' });
  }
);
