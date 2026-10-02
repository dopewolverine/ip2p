import { pool } from '../db/pool';
import { emitNotificationStandalone } from './notifications';

// Spec P4 §4.2 - "new device login" is security priority (email always,
// unmutable). True device fingerprinting isn't built anywhere in this
// project; this uses user-agent as a rough proxy - checking whether
// this exact user-agent string has ever created a session for this user
// before. Good enough to catch "logged in from a browser/device never
// seen on this account," not good enough to catch a spoofed user-agent.
// A real device-trust system (cookies, fingerprint hashing) would replace
// this outright rather than extend it.
export async function notifyIfNewDevice(userId: string, userAgent: string | null): Promise<void> {
  if (!userAgent) return;

  const { rows } = await pool.query(
    `SELECT 1 FROM sessions WHERE user_id = $1 AND user_agent = $2 LIMIT 1`,
    [userId, userAgent]
  );
  // The session just created by this login already exists by the time
  // this runs, so ">= 1" (not "> 1") means "seen before" only when a
  // PRIOR row also matches - callers must call this AFTER the new
  // session insert, and this query alone can't distinguish "just this
  // one" from "this one and an old one," so it's approximate by design;
  // see the note above.
  if (rows.length > 0) {
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS c FROM sessions WHERE user_id = $1 AND user_agent = $2`,
      [userId, userAgent]
    );
    if (Number(countRows[0].c) > 1) return; // seen this user-agent before this login
  }

  await emitNotificationStandalone({
    userId, type: 'new_device_login', priority: 'security',
    payload: { user_agent: userAgent },
    dedupeKey: `${Date.now()}`,
  });
}
