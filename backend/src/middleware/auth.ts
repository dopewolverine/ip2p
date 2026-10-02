import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { verifySessionToken, revokeAllSessions } from '../lib/sessions';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; status: string };
      sessionId?: string;
    }
  }
}

// "pending_seed_confirmation blocks everything except
// confirming or deleting." Previously a pending account could trade,
// post offers and move funds before ever confirming its seed.
const PENDING_ALLOWED = new Set([
  '/auth/register/confirm-seed',
  '/auth/account/delete/request',
  '/auth/me',
  '/auth/logout',
]);

export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  if (!token || typeof token !== 'string') {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  const { rows } = await pool.query('SELECT id, status FROM users WHERE id = $1', [session.user_id]);
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  // Bans: account status is checked on every request, and a disabled or
  // deleted account loses all of its sessions.
  if (user.status === 'disabled' || user.status === 'deleted') {
    await revokeAllSessions(user.id);
    return res.status(403).json({ error: 'account_not_active' });
  }

  if (user.status === 'pending_seed_confirmation' && !PENDING_ALLOWED.has(req.baseUrl + req.path)) {
    return res.status(403).json({ error: 'seed_confirmation_required' });
  }

  req.user = { id: user.id, status: user.status };
  req.sessionId = session.id;
  next();
}
