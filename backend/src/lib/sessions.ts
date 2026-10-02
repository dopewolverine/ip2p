import { pool } from '../db/pool';
import { randomToken, sha256Hex } from './crypto';

const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const ABSOLUTE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(
  userId: string,
  ipHash: string | null,
  userAgent: string | null
): Promise<string> {
  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + ABSOLUTE_MAX_MS);

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, userAgent, ipHash, expiresAt]
  );

  return token;
}

export async function verifySessionToken(token: string) {
  const tokenHash = sha256Hex(token);
  const { rows } = await pool.query(
    `SELECT * FROM sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  const session = rows[0];
  if (!session) return null;

  if (Date.now() - new Date(session.last_seen_at).getTime() > IDLE_TIMEOUT_MS) {
    return null;
  }

  await pool.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [session.id]);
  return session;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

// Used after a password change: the session that made the change stays
// signed in, every other session is ended.
export async function revokeOtherSessions(userId: string, keepSessionId: string | undefined): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, keepSessionId ?? null]
  );
}

// Spec §12: "any login cancels it." Called from every successful
// authentication path - plain login, TOTP, recovery-code. Also records
// last_login_at here (spec P3 §3.4 - offer auto-pause needs this) since
// every one of those call sites is, by definition, a successful login.
export async function cancelPendingDeletionIfNeeded(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET status = CASE WHEN status = 'pending_deletion' THEN 'active' ELSE status END,
         deletion_due_at = CASE WHEN status = 'pending_deletion' THEN NULL ELSE deletion_due_at END,
         last_login_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [userId]
  );
}
