import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { hashIp } from '../lib/crypto';
import {
  generateTotpSecret, totpProvisioningUri, matchTotpStep, encryptTotpSecret,
} from '../lib/totp';
import { verifySecondFactor } from '../lib/secondFactor';
import { createTotpSetupToken, verifyTotpSetupToken } from '../lib/totpSetupToken';
import { generateRecoveryCode, hashRecoveryCode } from '../lib/recoveryCodes';
import { verifyStepup } from '../lib/stepupAuth';
import { logAuthEvent } from '../lib/authEvents';
import { sendEmail } from '../lib/email';
import { rateLimit } from '../middleware/rateLimit';
import { emitNotificationStandalone } from '../lib/notifications';
import { requireSession } from '../middleware/auth';

export const totpRouter = Router();

totpRouter.post('/totp/setup', requireSession, async (req, res) => {
  const { rows } = await pool.query('SELECT username, totp_enabled FROM users WHERE id = $1', [req.user!.id]);
  const user = rows[0];
  if (user.totp_enabled) return res.status(409).json({ error: 'totp_already_enabled' });

  const secret = generateTotpSecret();
  const setup_token = createTotpSetupToken(req.user!.id, secret);

  res.json({
    setup_token,
    secret,
    otpauth_url: totpProvisioningUri(user.username, secret),
  });
});

const enableSchema = z.object({
  setup_token: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
  verifier: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

totpRouter.post(
  '/totp/enable',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyFn: (req) => `totp_enable:${req.user?.id ?? req.ip}` }),
  async (req, res) => {
    const parsed = enableSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const userId = req.user!.id;
    const ipHash = hashIp(req.ip ?? '', env.serverSecret);
    const userAgent = req.get('user-agent') ?? null;

    const stepupOk = await verifyStepup(req, userId, parsed.data.verifier);
    if (!stepupOk) return res.status(401).json({ error: 'invalid_password' });

    const secret = verifyTotpSetupToken(parsed.data.setup_token, userId);
    if (!secret) return res.status(401).json({ error: 'invalid_or_expired_setup' });

    const enabledStep = matchTotpStep(secret, parsed.data.code);
    if (enabledStep === null) {
      await logAuthEvent({ userId, eventType: 'totp_failed', ipHash, userAgent });
      return res.status(401).json({ error: 'invalid_code' });
    }

    const recoveryCodes = Array.from({ length: 10 }, () => generateRecoveryCode());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE users
         SET totp_enabled = true, totp_secret_enc = $1, totp_last_step = $3,
             reputation_held_until = now() + interval '48 hours', updated_at = now()
         WHERE id = $2`,
        [encryptTotpSecret(secret), userId, enabledStep]
      );

      await client.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
      for (const code of recoveryCodes) {
        await client.query(
          `INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
          [userId, hashRecoveryCode(code)]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }

    await logAuthEvent({ userId, eventType: 'totp_enabled', ipHash, userAgent });
    await emitNotificationStandalone({ userId, type: 'totp_changed', priority: 'security', payload: { action: 'enabled' }, dedupeKey: `${Date.now()}` });

    res.json({ status: 'ok', recovery_codes: recoveryCodes });
  }
);

const disableSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  verifier: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

totpRouter.post(
  '/totp/disable/request',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyFn: (req) => `totp_disable:${req.user?.id ?? req.ip}` }),
  async (req, res) => {
    const parsed = disableSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const userId = req.user!.id;
    const ipHash = hashIp(req.ip ?? '', env.serverSecret);
    const userAgent = req.get('user-agent') ?? null;

    const stepupOk = await verifyStepup(req, userId, parsed.data.verifier);
    if (!stepupOk) return res.status(401).json({ error: 'invalid_password' });

    const { rows } = await pool.query('SELECT totp_enabled, email FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user.totp_enabled) {
      return res.status(409).json({ error: 'totp_not_enabled' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const second = await verifySecondFactor(client, userId, { code: parsed.data.code });
      if (!second.ok) {
        await client.query('ROLLBACK');
        await logAuthEvent({ userId, eventType: 'totp_failed', ipHash, userAgent });
        return res.status(second.reason === 'locked' ? 429 : 401).json({ error: second.reason === 'locked' ? 'too_many_attempts' : 'invalid_code' });
      }
      // P0 §9 - any 2FA change sets the 48h reputation hold.
      await client.query(
        `UPDATE users SET totp_disable_due_at = now() + interval '48 hours',
                          reputation_held_until = now() + interval '48 hours', updated_at = now()
         WHERE id = $1`,
        [userId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await logAuthEvent({ userId, eventType: 'totp_disable_requested', ipHash, userAgent });
    await emitNotificationStandalone({ userId, type: 'totp_changed', priority: 'security', payload: { action: 'disable_requested' }, dedupeKey: `${Date.now()}` });

    if (user.email) {
      await sendEmail(
        user.email,
        'Two-factor authentication will be disabled in 48 hours',
        `A request to disable 2FA on your account was just made and confirmed with ` +
          `your password and an authenticator code.\n\n` +
          `It will take effect in 48 hours. If this wasn't you, your password and ` +
          `authenticator app may both be compromised — reset your password immediately ` +
          `and, if you still have your seed phrase, use it to recover your account.`
      );
    }

    res.json({ status: 'ok', effective_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() });
  }
);
