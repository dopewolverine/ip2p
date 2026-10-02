import { pool } from '../db/pool';
import { resolve, sep } from 'path';
import { unlink } from 'fs/promises';

export async function sweepAccountDeletions(): Promise<void> {
  const { rows } = await pool.query(`SELECT id FROM users WHERE status = 'pending_deletion' AND deletion_due_at <= now()`);
  for (const row of rows) await pool.query('SELECT purge_due_account($1)', [row.id]);
  const files = await pool.query('SELECT storage_path FROM attachment_deletion_queue');
  const root = resolve(process.env.ATTACHMENTS_STORAGE_DIR ?? '/var/data/ip2p/attachments');
  for (const file of files.rows) {
    const path = resolve(file.storage_path);
    if (!path.startsWith(root + sep)) { console.error('attachment_cleanup_invalid_path'); continue; }
    try { await unlink(path); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') continue; }
    await pool.query('DELETE FROM attachment_deletion_queue WHERE storage_path = $1', [file.storage_path]);
  }
}
export function startAccountDeletionSweep(): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await sweepAccountDeletions(); }
    catch { console.error('account_deletion_sweep_failed'); }
    finally { running = false; }
  }, 60_000).unref();
}
