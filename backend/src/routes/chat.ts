import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { pool } from '../db/pool';
import { requireSession } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { filterContactDetails } from '../chat/contactFilter';
import { storeAttachment, readAttachmentForUser, AttachmentError } from '../chat/attachments';
import { emitNotification } from '../lib/notifications';
import { isStaffOrOwner } from '../lib/roles';
import { idParam } from '../lib/params';

export const chatRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function assertParticipantOrStaff(contractId: string, userId: string): Promise<'vendor' | 'customer' | 'staff'> {
  const { rows } = await pool.query('SELECT vendor_id, customer_id FROM contracts WHERE id = $1', [contractId]);
  const contract = rows[0];
  if (!contract) throw new AttachmentError('not_found', 'Contract not found');

  if (contract.vendor_id === userId) return 'vendor';
  if (contract.customer_id === userId) return 'customer';

  if (await isStaffOrOwner(userId)) return 'staff';

  throw new AttachmentError('forbidden', 'Not a participant');
}

// ---- GET /trades/:id/messages ----
// Spec §2.1 - polling, not websockets, every 5s while the trade is open
// (the interval lives in the frontend; this is just a plain list read).
chatRouter.get('/trades/:id/messages', requireSession, async (req, res) => {
  try {
    await assertParticipantOrStaff(idParam(req), req.user!.id);
  } catch (err) {
    if (err instanceof AttachmentError) return res.status(err.code === 'not_found' ? 404 : 403).json({ error: err.code });
    throw err;
  }

  const since = typeof req.query.since === 'string' ? req.query.since : null;
  const { rows } = await pool.query(
    `SELECT id, sender_type, sender_id, body, attachment_id, created_at
     FROM messages
     WHERE contract_id = $1 ${since ? 'AND created_at > $2' : ''}
     ORDER BY created_at ASC`,
    since ? [idParam(req), since] : [idParam(req)]
  );
  res.json({ messages: rows });
});

// ---- POST /trades/:id/messages ----
// Spec §2.1 - opens at `requested`, before anything is committed. No
// state check here beyond the contract existing and not being terminal
// in a way that closes the thread - the spec doesn't actually say chat
// closes on cancellation/release, so it stays open for the historical
// record even after the trade concludes.
const sendSchema = z.object({ body: z.string().trim().min(1).max(4000) });

chatRouter.post(
  '/trades/:id/messages',
  requireSession,
  rateLimit({ windowMs: 60 * 1000, max: 20, keyFn: (req) => `chat_send:${req.user!.id}` }),
  async (req, res) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    let senderType: 'vendor' | 'customer' | 'staff';
    try {
      senderType = await assertParticipantOrStaff(idParam(req), req.user!.id);
    } catch (err) {
      if (err instanceof AttachmentError) return res.status(err.code === 'not_found' ? 404 : 403).json({ error: err.code });
      throw err;
    }

    // Spec §2.4 - filter, don't block.
    const { filtered, wasFiltered } = filterContactDetails(parsed.data.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO messages (contract_id, sender_type, sender_id, body)
         VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
        [idParam(req), senderType, req.user!.id, filtered]
      );

      // Spec §4.2 - low priority, web only. Notify the other party (not staff/self).
      const { rows: contractRows } = await client.query(
        'SELECT reference, vendor_id, customer_id FROM contracts WHERE id = $1',
        [idParam(req)]
      );
      const contract = contractRows[0];
      if (contract) {
        const recipient = senderType === 'vendor' ? contract.customer_id
          : senderType === 'customer' ? contract.vendor_id
          : null; // staff messages don't auto-notify a specific "other party" here
        if (recipient) {
          await emitNotification(client, {
            userId: recipient, type: 'new_chat_message', priority: 'low', contractId: idParam(req),
            payload: { reference: contract.reference },
            dedupeKey: rows[0].id, // one notification per message, not one ever per contract
          });
        }
      }

      await client.query('COMMIT');
      res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at, body: filtered, filtered: wasFiltered });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('send message failed', err);
      res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  }
);

// ---- POST /trades/:id/attachments ----
chatRouter.post(
  '/trades/:id/attachments',
  requireSession,
  rateLimit({ windowMs: 60 * 1000, max: 10, keyFn: (req) => `chat_upload:${req.user!.id}` }),
  upload.single('file'),
  async (req, res) => {
    let senderType: string;
    try {
      senderType = await assertParticipantOrStaff(idParam(req), req.user!.id);
    } catch (err) {
      if (err instanceof AttachmentError) return res.status(err.code === 'not_found' ? 404 : 403).json({ error: err.code });
      throw err;
    }

    if (!req.file) return res.status(400).json({ error: 'no_file' });

    try {
      const { id } = await storeAttachment({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalFilename: req.file.originalname,
        uploaderId: req.user!.id,
        contractId: idParam(req),
      });

      await pool.query(
        `INSERT INTO messages (contract_id, sender_type, sender_id, attachment_id) VALUES ($1, $2, $3, $4)`,
        [idParam(req), senderType, req.user!.id, id]
      );

      res.status(201).json({ attachment_id: id });
    } catch (err) {
      if (err instanceof AttachmentError) return res.status(400).json({ error: err.code, message: err.message });
      console.error('attachment upload failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  }
);

// ---- GET /attachments/:id ----
// Spec §2.5 - authenticated, scoped. Never served as a static file
// under the web root; this route is the only path to the bytes.
chatRouter.get('/attachments/:id', requireSession, async (req, res) => {
  const result = await readAttachmentForUser(idParam(req), req.user!.id);
  if (!result) return res.status(403).json({ error: 'forbidden_or_not_found' });
  // A non-ASCII filename (e.g. "comprobante_año.pdf") made setHeader
  // throw, so the attachment could never be opened. RFC 6266/5987 encoding
  // with an ASCII fallback. PDFs download rather than render inline.
  const asciiName = result.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const disposition = result.mimeType === 'application/pdf' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
  res.send(result.buffer);
});
