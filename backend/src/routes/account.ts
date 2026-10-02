import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { hashIp, hashAuthVerifier } from '../lib/crypto';
import { meetsKdfFloor } from '../lib/kdfParams';
import { verifyStepup } from '../lib/stepupAuth';
import { verifySecondFactor } from '../lib/secondFactor';
import { revokeOtherSessions } from '../lib/sessions';
import { logAuthEvent } from '../lib/authEvents';
import { sendEmail } from '../lib/email';
import { emitNotificationStandalone } from '../lib/notifications';
import { rateLimit } from '../middleware/rateLimit';
import { requireSession } from '../middleware/auth';

export const accountRouter = Router();

const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

const deleteRequestSchema = z.object({
  verifier: b64,
  code: z.string().regex(/^\d{6}$/).optional(),
});

accountRouter.post(
  '/account/delete/request',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyFn: (req) => `delete_request:${req.user!.id}` }),
  async (req, res) => {
    const parsed = deleteRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const userId = req.user!.id;
    const ipHash = hashIp(req.ip ?? '', env.serverSecret);
    const userAgent = req.get('user-agent') ?? null;

    const stepupOk = await verifyStepup(req, userId, parsed.data.verifier);
    if (!stepupOk) return res.status(401).json({ error: 'invalid_password' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT totp_enabled, status FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const user = rows[0];

      if (user.status === 'pending_deletion') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'deletion_already_requested' });
      }

      if (user.totp_enabled) {
        if (!parsed.data.code) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'totp_code_required' });
        }
        const second = await verifySecondFactor(client, userId, { code: parsed.data.code });
        if (!second.ok) {
          await client.query('ROLLBACK');
          await logAuthEvent({ userId, eventType: 'totp_failed', ipHash, userAgent });
          return res.status(second.reason === 'locked' ? 429 : 401).json({ error: second.reason === 'locked' ? 'too_many_attempts' : 'invalid_code' });
        }
      }

      const deletionDueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await client.query(
        `UPDATE users SET status = 'pending_deletion', deletion_due_at = $1, updated_at = now() WHERE id = $2`,
        [deletionDueAt, userId]
      );
      await client.query('COMMIT');

      await logAuthEvent({ userId, eventType: 'account_disabled', ipHash, userAgent, metadata: { reason: 'deletion_requested' } });
      res.json({ status: 'ok', deletion_due_at: deletionDueAt.toISOString() });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
);

// ---- POST /auth/password/change ----
// "Change password - gated by the old password." The build had
// no way to change a password at all, and the only endpoint that could
// (/recover/set-blob) required no password. The client re-encrypts the SAME
// mnemonic under the new password, so wallets and the recovery key are
// unchanged; the previous blob is archived as with a reset (P0 §7.2).
const changeSchema = z.object({
  verifier: b64, // old password's verifier, checked like any step-up
  new_verifier: b64,
  new_salt: b64,
  new_iv: b64,
  new_blob: b64,
  new_kdf_params: z.object({
    alg: z.string(), m: z.number(), t: z.number(), p: z.number(), version: z.number().optional(),
  }),
});

accountRouter.post(
  '/password/change',
  requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyFn: (req) => `password_change:${req.user!.id}` }),
  async (req, res) => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const userId = req.user!.id;
    const newVerifier = Buffer.from(parsed.data.new_verifier, 'base64');
    const salt = Buffer.from(parsed.data.new_salt, 'base64');
    const iv = Buffer.from(parsed.data.new_iv, 'base64');
    const blob = Buffer.from(parsed.data.new_blob, 'base64');
    if (newVerifier.length !== 32) return res.status(400).json({ error: 'invalid_verifier_length' });
    if (salt.length !== 16) return res.status(400).json({ error: 'invalid_salt_length' });
    if (iv.length !== 12) return res.status(400).json({ error: 'invalid_iv_length' });
    if (!meetsKdfFloor(parsed.data.new_kdf_params)) return res.status(400).json({ error: 'kdf_params_below_floor' });

    // Shares the per-account step-up failure counter (P0 §3.1.1).
    const ok = await verifyStepup(req, userId, parsed.data.verifier);
    if (!ok) return res.status(401).json({ error: 'invalid_password' });

    const { rows } = await pool.query('SELECT server_salt, email FROM users WHERE id = $1', [userId]);
    const authHash = await hashAuthVerifier(newVerifier, Buffer.from(rows[0].server_salt));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE wallet_blobs SET status = 'archived', archived_at = now() WHERE user_id = $1 AND status = 'current'`,
        [userId]
      );
      await client.query(
        `INSERT INTO wallet_blobs (user_id, blob, iv, salt, kdf_params, status) VALUES ($1, $2, $3, $4, $5, 'current')`,
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
      userId, eventType: 'password_changed',
      ipHash: hashIp(req.ip ?? '', env.serverSecret), userAgent: req.get('user-agent') ?? null,
    });
    await emitNotificationStandalone({ userId, type: 'password_changed', priority: 'security', dedupeKey: `${Date.now()}` });
    if (rows[0].email) {
      await sendEmail(rows[0].email, 'Your iP2P password was changed',
        `Your password was just changed and every other session was signed out. If this wasn't you, ` +
        `recover your account with your seed phrase now.`);
    }

    res.json({ status: 'ok' });
  }
);
