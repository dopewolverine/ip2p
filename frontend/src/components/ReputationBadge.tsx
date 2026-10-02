'use client';

import React from 'react';
import { vtInk, vtInkDim, vtGold, vtSage, vtMono } from './vtTokens';
import { VendorReputation } from '@/lib/api/marketplace';

export function ReputationBadge({ reputation }: { reputation: VendorReputation | undefined }) {
  if (!reputation) return null;

  if (reputation.held) {
    return (
      <span style={{
        fontFamily: vtMono, fontSize: 10, color: vtGold, border: `1px solid ${vtGold}`,
        borderRadius: 3, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        recently recovered
      </span>
    );
  }

  const badgeColor = reputation.badge === 'trusted' ? vtGold : reputation.badge === 'established' ? vtSage : vtInkDim;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontFamily: vtMono, fontSize: 9.5, color: badgeColor, border: `1px solid ${badgeColor}`,
          borderRadius: 3, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {reputation.badge}
        </span>
        <span style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim }}>
          {reputation.total_trades} trades · {reputation.distinct_counterparties} counterparties
        </span>
      </div>
      {reputation.completion_rate_30d != null && (
        <span style={{ fontFamily: vtMono, fontSize: 10, color: vtInkDim, opacity: 0.75 }}>
          {(reputation.completion_rate_30d * 100).toFixed(0)}% completion (30d) · {reputation.trades_30d} trades (30d)
        </span>
      )}
    </div>
  );
}
