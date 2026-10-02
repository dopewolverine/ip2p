import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { pool } from '../db/pool';
import { requireSession } from '../middleware/auth';
import { sendTelegramMessage } from '../lib/telegramBot';

export const notificationsRouter = Router();

// ---- GET /notifications ----
notificationsRouter.get('/notifications', requireSession, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, type, priority, contract_id, payload, read_at, created_at
     FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.user!.id]
  );
  res.json({ notifications: rows });
});

notificationsRouter.post('/notifications/:id/read', requireSession, async (req, res) => {
  await pool.query(
    `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [req.params.id, req.user!.id]
  );
  res.json({ status: 'ok' });
});

// ---- GET/PUT /notification-preferences ----
// Spec §4.2 - every category is user-configurable except security,
// which never appears here at all (there's nothing to toggle for it).
notificationsRouter.get('/notification-preferences', requireSession, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM notification_preferences WHERE user_id = $1', [req.user!.id]);
  res.json(rows[0] ?? {
    critical_web: true, critical_telegram: true, critical_email: true,
    normal_web: true, normal_telegram: true, low_web: true,
  });
});

const prefsSchema = z.object({
  critical_web: z.boolean().optional(), critical_telegram: z.boolean().optional(), critical_email: z.boolean().optional(),
  normal_web: z.boolean().optional(), normal_telegram: z.boolean().optional(), low_web: z.boolean().optional(),
});

notificationsRouter.put('/notification-preferences', requireSession, async (req, res) => {
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const fields = Object.keys(parsed.data);
  if (fields.length === 0) return res.json({ status: 'ok' });

  const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  await pool.query(
    `INSERT INTO notification_preferences (user_id, ${fields.join(', ')})
     VALUES ($1, ${fields.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${setClauses}`,
    [req.user!.id, ...fields.map((f) => (parsed.data as any)[f])]
  );

  res.json({ status: 'ok' });
});

// ---- Telegram linking (spec §4.4) ----

notificationsRouter.post('/telegram/link-token', requireSession, async (req, res) => {
  const token = randomBytes(16).toString('hex');
  await pool.query(
    `INSERT INTO telegram_link_tokens (token, user_id, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`,
    [token, req.user!.id]
  );
  // The user sends this token as a message to the bot; the bot's own
  // webhook handler (not built here - see project README) calls
  // POST /telegram/confirm below with the token and the resulting chat_id.
  res.json({ token, expires_in: 600 });
});

// The Telegram link flow could never complete - no bot
// handler existed, and the confirm endpoint was public with no check that
// the caller was Telegram. This is the bot webhook. Register it with
// setWebhook(url=<API>/telegram/webhook, secret_token=TELEGRAM_WEBHOOK_SECRET);
// Telegram then sends that secret in X-Telegram-Bot-Api-Secret-Token.
function webhookAuthorized(header: string | undefined): boolean {
  const expected = env.telegramWebhookSecret;
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

notificationsRouter.post('/telegram/webhook', async (req, res) => {
  if (!webhookAuthorized(req.get('x-telegram-bot-api-secret-token'))) return res.status(401).json({ error: 'unauthorized' });

  const text = req.body?.message?.text;
  const chatIdRaw = req.body?.message?.chat?.id;
  // Always 200 to Telegram for anything we don't act on, or it retries.
  if (typeof text !== 'string' || (typeof chatIdRaw !== 'number' && typeof chatIdRaw !== 'string')) return res.json({ ok: true });
  const token = text.trim().replace(/^\/start\s+/, '');
  if (!/^[0-9a-f]{32}$/.test(token)) return res.json({ ok: true });
  const chatId = String(chatIdRaw);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT user_id FROM telegram_link_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [token]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.json({ ok: true }); }
    await client.query(`UPDATE telegram_link_tokens SET used_at = now() WHERE token = $1`, [token]);
    await client.query(
      `INSERT INTO telegram_links (user_id, chat_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id`,
      [rows[0].user_id, chatId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  try {
    await sendTelegramMessage(chatId, 'iP2P notifications are now linked to this chat.');
  } catch (err) {
    console.error('confirmation message send failed (link itself still succeeded)', err);
  }
  res.json({ ok: true });
});

notificationsRouter.post('/telegram/unlink', requireSession, async (req, res) => {
  await pool.query('DELETE FROM telegram_links WHERE user_id = $1', [req.user!.id]);
  res.json({ status: 'unlinked' });
});
