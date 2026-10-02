import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { hashAuthVerifier, hashIp, randomToken, sha256Hex } from '../lib/crypto';
import { meetsKdfFloor, RECOMMENDED_KDF_PARAMS } from '../lib/kdfParams';
import { revokeAllSessions } from '../lib/sessions';
import { verifySecondFactor } from '../lib/secondFactor';
import { logAuthEvent } from '../lib/authEvents';
import { sendEmail } from '../lib/email';
import { rateLimit } from '../middleware/rateLimit';
import { emitNotificationStandalone } from '../lib/notifications';
import { requireSession } from '../middleware/auth';

export const passwordResetRouter = Router();

const requestSchema = z.object({ email: z.string().email() });

passwordResetRouter.post(
  '/password-reset/request',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 3, keyFn: (req) => `reset_ip:${req.ip}` }),
  rateLimit({
    windowMs: 60 * 60 * 1000, max: 3,
    keyFn: (req) => `reset_email:${String(req.body?.email ?? '').toLowerCase()}`,
  }),
  async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.json({ status: 'ok' });

    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email = $1 AND status NOT IN ('deleted')`,
      [parsed.data.email]
    );
    const user = rows[0];

    if (user) {
      const token = randomToken(32);
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 minutes')`,
        [user.id, sha256Hex(token)]
      );

      const link = `${env.frontendUrl}/reset-password?token=${token}`;
      await sendEmail(
        parsed.data.email,
        'Reset your iP2P password',
        `A password reset was requested for your account.\n\n` +
          `This link expires in 30 minutes and can be used once:\n${link}\n\n` +
          `Resetting your password does not recover your crypto. If you don't have ` +
          `your recovery phrase, your existing wallets will become inaccessible.\n\n` +
          `If you didn't request this, ignore this email.`
      );

      await logAuthEvent({
        userId: user.id,
        eventType: 'password_reset_requested',
        ipHash: hashIp(req.ip ?? '', env.serverSecret),
        userAgent: req.get('user-agent') ?? null,
      });
    }

    res.json({ status: 'ok' });
  }
);

passwordResetRouter.get(
  '/password-reset/validate',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => `reset_validate_ip:${req.ip}` }),
  async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) return res.status(400).json({ valid: false });

    const { rows } = await pool.query(
      `SELECT u.username, u.totp_enabled
       FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()`,
      [sha256Hex(token)]
    );
    if (rows.length === 0) return res.json({ valid: false });

    // totp_required tells the reset page to ask for the second factor
    // before the user types a new password.
    res.json({
      valid: true,
      username: rows[0].username,
      kdf_params: RECOMMENDED_KDF_PARAMS,
      totp_required: rows[0].totp_enabled === true,
    });
  }
);

const confirmSchema = z.object({
  token: z.string().min(1),
  new_verifier: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  new_salt: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  new_iv: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  new_blob: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  new_kdf_params: z.object({
    alg: z.string(), m: z.number(), t: z.number(), p: z.number(), version: z.number().optional(),
  }),
  new_recovery_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  // Required when the account has 2FA enabled.
  totp_code: z.string().regex(/^\d{6}$/).optional(),
  recovery_code: z.string().min(1).max(20).optional(),
});

passwordResetRouter.post(
  '/password-reset/confirm',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (req) => `reset_confirm_ip:${req.ip}` }),
  async (req, res) => {
    const parsed = confirmSchema.safeParse(req.body);
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

    const tokenHash = sha256Hex(parsed.data.token);
    const ipHash = hashIp(req.ip ?? '', env.serverSecret);
    const userAgent = req.get('user-agent') ?? null;

    const client = await pool.connect();
    let userId: string;
    let email: string | null;
    try {
      await client.query('BEGIN');

      const { rows: tokenRows } = await client.query(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash]
      );
      const resetToken = tokenRows[0];
      if (!resetToken) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'invalid_or_expired_token' });
      }

      userId = resetToken.user_id;

      const { rows: userRows } = await client.query(
        'SELECT server_salt, email, totp_enabled FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const user = userRows[0];
      email = user.email;

      // An email reset replaces the account's recovery key
      // (P0 §7), and seed-phrase recovery logs in without 2FA (P0 §7A). Put
      // together, anyone with access to the user's inbox could reset, set
      // their own recovery key, and log in past 2FA. With 2FA on, the reset
      // now also needs a current code or an unused recovery code.
      if (user.totp_enabled) {
        if (!parsed.data.totp_code && !parsed.data.recovery_code) {
          await client.query('ROLLBACK');
          return res.status(401).json({ error: 'totp_required' });
        }
        const second = await verifySecondFactor(client, userId, {
          code: parsed.data.totp_code, recoveryCode: parsed.data.recovery_code,
        });
        if (!second.ok) {
          await client.query('ROLLBACK');
          await logAuthEvent({ userId, eventType: 'totp_failed', ipHash, userAgent, metadata: { via: 'password_reset' } });
          return res.status(second.reason === 'locked' ? 429 : 401).json({ error: second.reason === 'locked' ? 'too_many_attempts' : 'invalid_code' });
        }
      }

      const authHash = await hashAuthVerifier(verifier, Buffer.from(user.server_salt));

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

      await client.query(
        `UPDATE users
         SET auth_hash = $1,
             recovery_address = $2,
             reputation_held_until = now() + interval '48 hours',
             updated_at = now()
         WHERE id = $3`,
        [authHash, parsed.data.new_recovery_address, userId]
      );

      await client.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`,
        [resetToken.id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await revokeAllSessions(userId);
    await logAuthEvent({ userId, eventType: 'password_reset_completed', ipHash, userAgent });
    await emitNotificationStandalone({ userId, type: 'password_changed', priority: 'security', dedupeKey: `${Date.now()}` });

    if (email) {
      // The old text told a victim to "recover with your
      // seed phrase" - but a reset without the seed installs a new recovery
      // key, so that advice could not work. This says what is true.
      await sendEmail(
        email,
        'Your iP2P password was reset',
        `Your password was just reset and all sessions were signed out.\n\n` +
          `If this wasn't you, someone has access to this email account. Secure ` +
          `your email first, then reset your iP2P password again from the login page.\n\n` +
          `Wallets created before the reset stay encrypted with your OLD password. ` +
          `If you still have your recovery phrase, move those funds to a new wallet.`
      );
    }

    res.json({ status: 'ok' });
  }
);

passwordResetRouter.get(
  '/wallet-blobs/archived',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => `archived_blobs:${req.user!.id}` }),
  async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, blob, iv, salt, kdf_params, created_at, archived_at
       FROM wallet_blobs
       WHERE user_id = $1 AND status = 'archived'
       ORDER BY archived_at DESC`,
      [req.user!.id]
    );

    res.json({
      blobs: rows.map((r) => ({
        id: r.id,
        blob: Buffer.from(r.blob).toString('base64'),
        iv: Buffer.from(r.iv).toString('base64'),
        salt: Buffer.from(r.salt).toString('base64'),
        kdf_params: r.kdf_params,
        created_at: r.created_at,
        archived_at: r.archived_at,
      })),
    });
  }
);
