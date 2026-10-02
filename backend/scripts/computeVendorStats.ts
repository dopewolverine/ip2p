/**
 * P5 §8.1 - nightly vendor stats computation. Standalone script, same
 * pattern as scripts/generateDiscoveryPages.ts - not an Express route,
 * meant for cron. "A marketplace page shows twenty vendors. Twenty live
 * aggregate queries per page load is a problem that arrives suddenly" -
 * this is what avoids that.
 *
 * Usage: ts-node scripts/computeVendorStats.ts
 * Cron (nightly):
 *   30 2 * * * cd /path/to/backend && npx ts-node scripts/computeVendorStats.ts >> /var/log/ip2p/vendor-stats.log 2>&1
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { BADGE_THRESHOLDS } from '../src/reputation/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface ReleasedContract {
  id: string; vendor_id: string; customer_id: string; crypto_side: 'vendor' | 'customer';
  closed_at: Date; funded_at: Date | null; paid_at: Date | null; fiat_amount: string;
}

interface CancelledContract {
  id: string; vendor_id: string; customer_id: string; crypto_side: 'vendor' | 'customer';
  closed_at: Date; trigger: string | null; actor_id: string | null; from_state: string | null;
}

// Spec §3.1 - "only cancellations attributable to that party count
// against them." Returns null for a no-fault cancellation (mutual
// refund) - nobody's rate is charged for those.
function attributeCancellation(c: CancelledContract): string | null {
  if (c.trigger === 'mutual_refund_broadcast') return null;
  if (c.trigger === 'cancel_requested') return c.actor_id;
  if (c.trigger === 'cancel_timer') {
    // requested → vendor never accepted in time; accepted → the funder
    // never got the escrow funded in time.
    if (c.from_state === 'requested') return c.vendor_id;
    if (c.from_state === 'accepted') return c.crypto_side === 'vendor' ? c.vendor_id : c.customer_id;
  }
  return null; // unknown trigger — don't attribute rather than guess
}

async function main() {
  console.log(`[${new Date().toISOString()}] Computing vendor stats`);

  const { rows: released } = await pool.query<ReleasedContract>(
    `SELECT id, vendor_id, customer_id, crypto_side, closed_at, funded_at, paid_at, fiat_amount
     FROM contracts WHERE state = 'released' AND closed_at IS NOT NULL`
  );

  const { rows: cancelledRaw } = await pool.query(
    `SELECT c.id, c.vendor_id, c.customer_id, c.crypto_side, c.closed_at, ct.trigger, ct.actor_id, ct.from_state
     FROM contracts c
     JOIN contract_transitions ct ON ct.contract_id = c.id AND ct.to_state = 'cancelled'
     WHERE c.state = 'cancelled' AND c.closed_at IS NOT NULL`
  );
  const cancelled = cancelledRaw as CancelledContract[];

  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const isWithin30d = (d: Date) => now - new Date(d).getTime() <= THIRTY_DAYS_MS;

  // Every user who has ever been a party to a released or cancelled contract.
  const userIds = new Set<string>();
  for (const c of released) { userIds.add(c.vendor_id); userIds.add(c.customer_id); }
  for (const c of cancelled) { userIds.add(c.vendor_id); userIds.add(c.customer_id); }

  const { rows: userRows } = await pool.query(
    `SELECT id, created_at FROM users WHERE id = ANY($1) AND status <> 'deleted'`,
    [[...userIds]]
  );
  const accountCreatedAt = new Map(userRows.map((r) => [r.id, new Date(r.created_at)]));

  let updated = 0;

  for (const userId of userIds) {
    if (!accountCreatedAt.has(userId)) continue;
    const releasedFor = released.filter((c) => c.vendor_id === userId || c.customer_id === userId);
    const cancelledFor = cancelled.filter((c) => c.vendor_id === userId || c.customer_id === userId);

    const totalTrades = releasedFor.length;
    const trades30d = releasedFor.filter((c) => isWithin30d(c.closed_at)).length;

    const completed30d = trades30d;
    const cancelledAttributable30d = cancelledFor.filter(
      (c) => isWithin30d(c.closed_at) && attributeCancellation(c) === userId
    ).length;
    const denom = completed30d + cancelledAttributable30d;
    const completionRate30d = denom > 0 ? completed30d / denom : null;

    const releaseTimes: number[] = [];
    const payTimes: number[] = [];
    for (const c of releasedFor) {
      const isCryptoSide = (c.crypto_side === 'vendor' && c.vendor_id === userId) || (c.crypto_side === 'customer' && c.customer_id === userId);
      if (isCryptoSide && c.paid_at) {
        releaseTimes.push((new Date(c.closed_at).getTime() - new Date(c.paid_at).getTime()) / 1000);
      }
      if (!isCryptoSide && c.funded_at && c.paid_at) {
        payTimes.push((new Date(c.paid_at).getTime() - new Date(c.funded_at).getTime()) / 1000);
      }
    }
    const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

    const counterparties = new Set(
      releasedFor.map((c) => (c.vendor_id === userId ? c.customer_id : c.vendor_id))
    );

    // "Volume" for the trusted-badge threshold - summed fiat_amount
    // across currencies, unconverted. A rough proxy (spec doesn't
    // specify currency normalization); revisit once there's a real
    // fiat-to-USD reference to normalize against.
    const volume = releasedFor.reduce((sum, c) => sum + parseFloat(c.fiat_amount), 0);

    const accountAgeDays = accountCreatedAt.has(userId)
      ? (now - accountCreatedAt.get(userId)!.getTime()) / (24 * 60 * 60 * 1000)
      : 0;

    let badge = 'new';
    const est = BADGE_THRESHOLDS.established;
    const trust = BADGE_THRESHOLDS.trusted;
    if (
      counterparties.size >= trust.distinctCounterparties &&
      accountAgeDays >= trust.accountAgeDays &&
      (completionRate30d ?? 0) >= trust.completionRate &&
      volume >= trust.volumeUsd
    ) {
      badge = 'trusted';
    } else if (
      counterparties.size >= est.distinctCounterparties &&
      accountAgeDays >= est.accountAgeDays &&
      (completionRate30d ?? 0) >= est.completionRate
    ) {
      badge = 'established';
    }

    await pool.query(
      `INSERT INTO vendor_stats (user_id, total_trades, trades_30d, completion_rate_30d,
         avg_release_seconds, avg_pay_seconds, distinct_counterparties, badge, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (user_id) DO UPDATE SET
         total_trades = EXCLUDED.total_trades, trades_30d = EXCLUDED.trades_30d,
         completion_rate_30d = EXCLUDED.completion_rate_30d, avg_release_seconds = EXCLUDED.avg_release_seconds,
         avg_pay_seconds = EXCLUDED.avg_pay_seconds, distinct_counterparties = EXCLUDED.distinct_counterparties,
         badge = EXCLUDED.badge, computed_at = now()`,
      [userId, totalTrades, trades30d, completionRate30d, avg(releaseTimes), avg(payTimes), counterparties.size, badge]
    );
    updated++;
  }

  console.log(`[${new Date().toISOString()}] Updated stats for ${updated} users`);
  await pool.end();
}

main().catch((err) => {
  console.error('computeVendorStats failed:', err);
  process.exit(1);
});
