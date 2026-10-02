import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { hashAuthVerifier, hashIp } from '../lib/crypto';
import { meetsKdfFloor } from '../lib/kdfParams';
import { createSession } from '../lib/sessions';
import { setSessionCookie } from '../lib/sessionCookie';
import { logAuthEvent } from '../lib/authEvents';
import { rateLimit } from '../middleware/rateLimit';
import { requireSession } from '../middleware/auth';

export const registerRouter = Router();

const usernameSchema = z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/);
const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'invalid_base64');

registerRouter.post(
  '/register/check',
  // Was unlimited - a free username-listing oracle.
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keyFn: (req) => `register_check:${req.ip}` }),
  async (req, res) => {
    const parsed = z.object({ username: usernameSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const { rows } = await pool.query('SELECT 1 FROM users WHERE username = $1', [parsed.data.username]);
    res.json({ available: rows.length === 0 });
  }
);

const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email().optional(),
  verifier: b64,
  salt: b64,
  iv: b64,
  blob: b64,
  kdf_params: z.object({
    alg: z.string(),
    m: z.number(),
    t: z.number(),
    p: z.number(),
    version: z.number().optional(),
  }),
  recovery_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'invalid_recovery_address'),
});

registerRouter.post(
  '/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyFn: (req) => `register:${req.ip}` }),
  async (req, res) => {
    // Sign-ups can be closed while the platform is not ready.
    if (!env.registrationOpen) {
      return res.status(403).json({ error: 'registration_closed', message: 'New sign-ups are temporarily closed.' });
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    }

    const { username, email, kdf_params, recovery_address } = parsed.data;
    const verifier = Buffer.from(parsed.data.verifier, 'base64');
    const blobSalt = Buffer.from(parsed.data.salt, 'base64');
    const iv = Buffer.from(parsed.data.iv, 'base64');
    const blob = Buffer.from(parsed.data.blob, 'base64');

    if (verifier.length !== 32) return res.status(400).json({ error: 'invalid_verifier_length' });
    if (blobSalt.length !== 16) return res.status(400).json({ error: 'invalid_salt_length' });
    if (iv.length !== 12) return res.status(400).json({ error: 'invalid_iv_length' });

    if (!meetsKdfFloor(kdf_params)) {
      return res.status(400).json({ error: 'kdf_params_below_floor' });
    }

    const ipHash = hashIp(req.ip ?? '', env.serverSecret);
    const userAgent = req.get('user-agent') ?? null;

    await logAuthEvent({ eventType: 'register_started', ipHash, userAgent, metadata: { username } });

    const serverSalt = randomBytes(16);
    const authHash = await hashAuthVerifier(verifier, serverSalt);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO users
           (username, email, auth_hash, server_salt, recovery_address, status)
         VALUES ($1, $2, $3, $4, $5, 'pending_seed_confirmation')
         RETURNING id`,
        [username, email ?? null, authHash, serverSalt, recovery_address]
      );
      const userId: string = userResult.rows[0].id;

      await client.query(
        `INSERT INTO wallet_blobs (user_id, blob, iv, salt, kdf_params, status)
         VALUES ($1, $2, $3, $4, $5, 'current')`,
        [userId, blob, iv, blobSalt, kdf_params]
      );

      await client.query('COMMIT');

      const token = await createSession(userId, ipHash, userAgent);
      setSessionCookie(res, token);

      await logAuthEvent({ userId, eventType: 'register_completed', ipHash, userAgent });

      res.status(201).json({ user_id: userId, status: 'pending_seed_confirmation' });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        const field = err.constraint?.includes('email') ? 'email' : 'username';
        return res.status(409).json({ error: `${field}_taken` });
      }
      console.error(err);
      res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  }
);

registerRouter.post('/register/confirm-seed', requireSession, async (req, res) => {
  const user = req.user!;

  if (user.status !== 'pending_seed_confirmation') {
    return res.status(409).json({ error: 'already_confirmed' });
  }

  await pool.query(`UPDATE users SET status = 'active', updated_at = now() WHERE id = $1`, [user.id]);
  await logAuthEvent({ userId: user.id, eventType: 'seed_confirmed' });

  res.json({ status: 'active' });
});
