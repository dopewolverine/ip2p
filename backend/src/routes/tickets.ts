import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { pool } from '../db/pool';
import { requireSession } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { storeAttachment, AttachmentError } from '../chat/attachments';
import { isStaffOrOwner } from '../lib/roles';
import { idParam } from '../lib/params';

export const ticketsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Staff access requires 2FA on the staff account.
const isStaff = isStaffOrOwner;

// ---- POST /tickets ----
const createSchema = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(4000) });

ticketsRouter.post(
  '/tickets',
  requireSession,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyFn: (req) => `ticket_create:${req.user!.id}` }),
  async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO tickets (user_id, subject, status, priority) VALUES ($1, $2, 'open', 'normal') RETURNING id`,
        [req.user!.id, parsed.data.subject]
      );
      await client.query(
        `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, body) VALUES ($1, 'user', $2, $3)`,
        [rows[0].id, req.user!.id, parsed.data.body]
      );
      await client.query('COMMIT');
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('ticket create failed', err);
      res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  }
);

// ---- GET /tickets ----
// Spec §5 - "users see their own tickets only." Staff see everything
// via the /tickets?all=true branch below (still gated by role).
ticketsRouter.get('/tickets', requireSession, async (req, res) => {
  const wantsAll = req.query.all === 'true' && (await isStaff(req.user!.id));
  const { rows } = await pool.query(
    wantsAll
      ? `SELECT t.*, u.username FROM tickets t JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 200`
      : `SELECT * FROM tickets WHERE user_id = $1 ORDER BY updated_at DESC`,
    wantsAll ? [] : [req.user!.id]
  );
  res.json({ tickets: rows });
});

async function assertTicketAccess(ticketId: string, userId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT user_id FROM tickets WHERE id = $1', [ticketId]);
  if (!rows[0]) return false;
  if (rows[0].user_id === userId) return true;
  return isStaff(userId);
}

// ---- GET /tickets/:id ----
// Single-ticket metadata - subject, status, owner username, assignment.
// Needed by the thread view so staff can see whose ticket they're
// looking at, not just the messages.
ticketsRouter.get('/tickets/:id', requireSession, async (req, res) => {
  if (!(await assertTicketAccess(idParam(req), req.user!.id))) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query(
    `SELECT t.*, u.username, s.username AS assigned_staff_username
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users s ON s.id = t.assigned_staff_id
     WHERE t.id = $1`,
    [idParam(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

// ---- GET /tickets/:id/messages ----
ticketsRouter.get('/tickets/:id/messages', requireSession, async (req, res) => {
  if (!(await assertTicketAccess(idParam(req), req.user!.id))) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query(
    `SELECT id, sender_type, sender_id, body, attachment_id, created_at FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [idParam(req)]
  );
  res.json({ messages: rows });
});

// ---- POST /tickets/:id/messages ----
const replySchema = z.object({ body: z.string().trim().min(1).max(4000) });

ticketsRouter.post('/tickets/:id/messages', requireSession, async (req, res) => {
  if (!(await assertTicketAccess(idParam(req), req.user!.id))) return res.status(403).json({ error: 'forbidden' });

  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const staff = await isStaff(req.user!.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, body) VALUES ($1, $2, $3, $4)`,
      [idParam(req), staff ? 'staff' : 'user', req.user!.id, parsed.data.body]
    );
    await client.query(
      `UPDATE tickets SET status = $1, updated_at = now() WHERE id = $2`,
      [staff ? 'awaiting_user' : 'awaiting_staff', idParam(req)]
    );
    await client.query('COMMIT');
    res.status(201).json({ status: 'ok' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ticket reply failed', err);
    res.status(500).json({ error: 'internal_error' });
  } finally {
    client.release();
  }
});

// ---- POST /tickets/:id/attachments ----
ticketsRouter.post('/tickets/:id/attachments', requireSession, upload.single('file'), async (req, res) => {
  if (!(await assertTicketAccess(idParam(req), req.user!.id))) return res.status(403).json({ error: 'forbidden' });
  if (!req.file) return res.status(400).json({ error: 'no_file' });

  try {
    const { id } = await storeAttachment({
      buffer: req.file.buffer, mimeType: req.file.mimetype, originalFilename: req.file.originalname,
      uploaderId: req.user!.id, ticketId: idParam(req),
    });
    res.status(201).json({ attachment_id: id });
  } catch (err) {
    if (err instanceof AttachmentError) return res.status(400).json({ error: err.code, message: err.message });
    console.error('ticket attachment failed', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---- POST /tickets/:id/close, /assign ----
ticketsRouter.post('/tickets/:id/close', requireSession, async (req, res) => {
  if (!(await assertTicketAccess(idParam(req), req.user!.id))) return res.status(403).json({ error: 'forbidden' });
  await pool.query(`UPDATE tickets SET status = 'closed', updated_at = now() WHERE id = $1`, [idParam(req)]);
  res.json({ status: 'closed' });
});

ticketsRouter.post('/tickets/:id/assign', requireSession, async (req, res) => {
  if (!(await isStaff(req.user!.id))) return res.status(403).json({ error: 'staff_only' });
  await pool.query(`UPDATE tickets SET assigned_staff_id = $1, updated_at = now() WHERE id = $2`, [req.user!.id, idParam(req)]);
  res.json({ status: 'assigned' });
});
