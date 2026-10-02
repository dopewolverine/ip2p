'use client';

import React from 'react';
import { vtGold, vtInkDim } from './vtTokens';

function MBtn({ href, primary, children, label }: { href: string; primary?: boolean; children: React.ReactNode; label: string }) {
  return (
    <a href={href} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', textDecoration: 'none',
      background: primary ? vtGold : '#1F2220', border: `1px solid ${primary ? vtGold : '#34372F'}`, borderRadius: 6,
    }}>
      <svg viewBox="0 0 20 20" width={13} height={13} style={{
        stroke: primary ? '#17191A' : vtGold, fill: 'none', strokeWidth: 1.7,
        filter: primary ? 'none' : 'drop-shadow(0 0 3px rgba(201,162,39,0.75))',
      }}>
        {children}
      </svg>
      <span style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, whiteSpace: 'nowrap',
        color: primary ? '#17191A' : vtInkDim, fontWeight: primary ? 600 : 400,
      }}>
        {label}
      </span>
    </a>
  );
}

export function MarketNav() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <MBtn href="/marketplace/new" primary label="create">
        <path d="M10 4v12M4 10h12" />
      </MBtn>
      <MBtn href="/marketplace/mine" label="mine">
        <path d="M4 6h12M4 10h12M4 14h8" />
      </MBtn>
      <MBtn href="/marketplace/inbox" label="requests">
        <path d="M4 4h12v8l-2.5 3h-7L4 12z" />
        <path d="M4 12h3.5l1 1.5h3l1-1.5H16" />
      </MBtn>
    </div>
  );
}
