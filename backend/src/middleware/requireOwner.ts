import { Request, Response, NextFunction } from 'express';
import { getStaffRole } from '../lib/roles';

// Spec P2 §8.2 - "Only the Owner role can initiate this. Staff may
// recommend an outcome; they cannot execute one." Applied on top of
// requireSession, never in place of it. Requires 2FA on the Owner account.
export async function requireOwner(req: Request, res: Response, next: NextFunction) {
  const role = await getStaffRole(req.user!.id);
  if (role !== 'owner') {
    return res.status(403).json({ error: 'owner_only', message: 'Owner role with two-factor enabled is required.' });
  }
  next();
}

export async function requireStaffOrOwner(req: Request, res: Response, next: NextFunction) {
  const role = await getStaffRole(req.user!.id);
  if (!role) {
    return res.status(403).json({ error: 'staff_or_owner_only', message: 'Staff role with two-factor enabled is required.' });
  }
  next();
}
