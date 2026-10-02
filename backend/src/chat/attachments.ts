import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { pool } from '../db/pool';
import { isStaffOrOwner } from '../lib/roles';

const STORAGE_DIR = process.env.ATTACHMENTS_STORAGE_DIR ?? '/var/data/ip2p/attachments';
const MAX_BYTES = Number(process.env.ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024);

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

export class AttachmentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Spec §2.5 - "images and PDF only. Size cap enforced server-side. Strip
// EXIF on upload." sharp re-encodes the image without copying metadata
// by default (its output pipeline only carries over what you explicitly
// ask it to, and EXIF/GPS isn't preserved unless `.withMetadata()` is
// called). Verify metadata removal with a real GPS-tagged photo before
// deployment (acceptance criterion 6).
export async function storeAttachment(params: {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
  uploaderId: string;
  contractId?: string;
  ticketId?: string;
}): Promise<{ id: string }> {
  if (!ALLOWED_MIME.has(params.mimeType)) {
    throw new AttachmentError('unsupported_type', 'Only images and PDF are accepted.');
  }
  if (params.buffer.length > MAX_BYTES) {
    throw new AttachmentError('too_large', `File exceeds the ${MAX_BYTES}-byte limit.`);
  }
  if (!params.contractId && !params.ticketId) {
    throw new AttachmentError('no_scope', 'Attachment must belong to a contract or a ticket.');
  }

  // The declared MIME type comes from the uploader. PDFs are stored
  // as-is, so check the actual bytes; images are re-encoded by sharp
  // below, which rejects anything that is not really an image.
  if (params.mimeType === 'application/pdf' && params.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new AttachmentError('unsupported_type', 'That file is not a valid PDF.');
  }

  let finalBuffer = params.buffer;
  if (params.mimeType.startsWith('image/')) {
    // Re-encoding through sharp with no .withMetadata() call strips
    // EXIF (including GPS) by construction - there's no metadata-copy
    // step for this pipeline to accidentally trigger.
    try {
      finalBuffer = await sharp(params.buffer).rotate().toBuffer();
    } catch {
      throw new AttachmentError('unsupported_type', 'That file is not a valid image.');
    }
  }
  // PDF: no metadata-stripping pass here - PDFs can carry their own
  // metadata (author, GPS in some generators) that sharp doesn't touch.
  // Not handled in this pass; a real deployment should add a PDF
  // metadata scrubber (e.g. via qpdf or a PDF library) before trusting
  // this for PDFs the way EXIF stripping is trusted for images.

  const id = randomUUID();
  const dir = join(STORAGE_DIR, params.contractId ?? params.ticketId!);
  mkdirSync(dir, { recursive: true });
  const storagePath = join(dir, id);
  writeFileSync(storagePath, finalBuffer);

  await pool.query(
    `INSERT INTO attachments (id, contract_id, ticket_id, uploader_id, storage_path, mime_type, size_bytes, original_filename)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, params.contractId ?? null, params.ticketId ?? null, params.uploaderId, storagePath, params.mimeType, finalBuffer.length, params.originalFilename]
  );

  return { id };
}

// Spec §2.5 - "access is checked against scope on every read: a
// participant of that contract, the owner of that ticket, or staff."
export async function readAttachmentForUser(attachmentId: string, userId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  const { rows } = await pool.query('SELECT * FROM attachments WHERE id = $1', [attachmentId]);
  const attachment = rows[0];
  if (!attachment) return null;

  const isStaff = await isStaffOrOwner(userId);

  let authorized = isStaff;
  if (!authorized && attachment.contract_id) {
    const { rows: contractRows } = await pool.query('SELECT vendor_id, customer_id FROM contracts WHERE id = $1', [attachment.contract_id]);
    const contract = contractRows[0];
    authorized = !!contract && [contract.vendor_id, contract.customer_id].includes(userId);
  }
  if (!authorized && attachment.ticket_id) {
    const { rows: ticketRows } = await pool.query('SELECT user_id FROM tickets WHERE id = $1', [attachment.ticket_id]);
    authorized = ticketRows[0]?.user_id === userId;
  }

  if (!authorized) return null;
  if (!existsSync(attachment.storage_path)) return null;

  return {
    buffer: readFileSync(attachment.storage_path),
    mimeType: attachment.mime_type,
    filename: attachment.original_filename,
  };
}
