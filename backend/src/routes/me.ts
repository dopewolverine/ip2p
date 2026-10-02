import { Router } from 'express';
import { pool } from '../db/pool';
import { requireSession } from '../middleware/auth';

export const meRouter = Router();

meRouter.get('/me', requireSession, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT username, email, totp_enabled, status, role FROM users WHERE id = $1',
    [req.user!.id]
  );
  const user = rows[0];
  res.json({ username: user.username, email: user.email, totp_enabled: user.totp_enabled, status: user.status, role: user.role });
});
