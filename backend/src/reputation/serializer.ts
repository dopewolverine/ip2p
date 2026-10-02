import { pool } from '../db/pool';

// Spec P5 §8.2 - "check it in ONE place, in the serialiser. Scattered
// checks are how a page gets missed." Every endpoint that shows a
// user's reputation - profile, offer listing, marketplace, trade page -
// must route through this function, never read vendor_stats directly.
export interface SerializedReputation {
  held: boolean;
  account_created_at?: string;
  total_trades?: number;
  trades_30d?: number;
  completion_rate_30d?: number | null;
  avg_release_seconds?: number | null;
  avg_pay_seconds?: number | null;
  distinct_counterparties?: number;
  badge?: string;
}

export async function getSerializedReputation(userId: string): Promise<SerializedReputation> {
  const { rows: userRows } = await pool.query(
    'SELECT created_at, reputation_held_until FROM users WHERE id = $1',
    [userId]
  );
  const user = userRows[0];
  if (!user) return { held: false };

  // Spec §6 - "trading is not blocked, the display is." This function
  // is only ever called for DISPLAY purposes; nothing here touches
  // whether a trade can proceed.
  if (user.reputation_held_until && new Date(user.reputation_held_until) > new Date()) {
    return { held: true };
  }

  const { rows: statsRows } = await pool.query('SELECT * FROM vendor_stats WHERE user_id = $1', [userId]);
  const stats = statsRows[0];

  return {
    held: false,
    account_created_at: user.created_at,
    total_trades: stats?.total_trades ?? 0,
    trades_30d: stats?.trades_30d ?? 0,
    completion_rate_30d: stats?.completion_rate_30d ?? null,
    avg_release_seconds: stats?.avg_release_seconds ?? null,
    avg_pay_seconds: stats?.avg_pay_seconds ?? null,
    distinct_counterparties: stats?.distinct_counterparties ?? 0,
    badge: stats?.badge ?? 'new',
  };
}

// Spec acceptance criterion 12 - "twenty vendors, one stats query, not
// twenty." Batched version for listing pages; same hold logic applied
// per-user, but only two round trips total regardless of list size.
export async function getSerializedReputationBatch(userIds: string[]): Promise<Map<string, SerializedReputation>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();

  const { rows: userRows } = await pool.query(
    'SELECT id, created_at, reputation_held_until FROM users WHERE id = ANY($1)',
    [unique]
  );
  const { rows: statsRows } = await pool.query('SELECT * FROM vendor_stats WHERE user_id = ANY($1)', [unique]);
  const statsByUser = new Map(statsRows.map((s) => [s.user_id, s]));

  const result = new Map<string, SerializedReputation>();
  for (const user of userRows) {
    if (user.reputation_held_until && new Date(user.reputation_held_until) > new Date()) {
      result.set(user.id, { held: true });
      continue;
    }
    const stats = statsByUser.get(user.id);
    result.set(user.id, {
      held: false,
      account_created_at: user.created_at,
      total_trades: stats?.total_trades ?? 0,
      trades_30d: stats?.trades_30d ?? 0,
      completion_rate_30d: stats?.completion_rate_30d ?? null,
      avg_release_seconds: stats?.avg_release_seconds ?? null,
      avg_pay_seconds: stats?.avg_pay_seconds ?? null,
      distinct_counterparties: stats?.distinct_counterparties ?? 0,
      badge: stats?.badge ?? 'new',
    });
  }
  return result;
}
