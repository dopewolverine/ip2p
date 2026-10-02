import { pool } from '../db/pool';

export type StaffRole = 'owner' | 'staff';

// "TOTP is mandatory on every staff account." A role
// only counts while 2FA is actually enabled on that account - a leaked
// password, config file or database backup is not enough to act as staff.
// Every staff/owner check in the codebase goes through here.
export async function getStaffRole(userId: string): Promise<StaffRole | null> {
  const { rows } = await pool.query('SELECT role, totp_enabled FROM users WHERE id = $1', [userId]);
  const row = rows[0];
  if (!row || (row.role !== 'owner' && row.role !== 'staff')) return null;
  if (!row.totp_enabled) return null;
  return row.role;
}

export async function isStaffOrOwner(userId: string): Promise<boolean> {
  return (await getStaffRole(userId)) !== null;
}

// "Separate accounts for trading and administration."
export async function hasAdminRole(userId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return rows[0]?.role === 'owner' || rows[0]?.role === 'staff';
}
