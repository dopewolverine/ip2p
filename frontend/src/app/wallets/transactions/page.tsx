'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtErr, vtLine, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { getTransactions, TransactionEntry } from '@/lib/api/wallet';
import { ASSET_DECIMALS, fromBaseUnits } from '@/lib/crypto/units';
import { ApiError } from '@/lib/api/client';

type View = 'loading' | 'signed-out' | 'ready';

export default function TransactionsPage() {
  const walletSession = useWalletSession();
  const [view, setView] = useState<View>('loading');
  const [txs, setTxs] = useState<TransactionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    me()
      .then(() => getTransactions())
      .then((res) => {
        setTxs(res.transactions);
        setView('ready');
      })
      .catch(() => setView('signed-out'));
  }, []);

  if (view === 'loading') return <AppShell section="Wallets"><VtPanel><p style={subStyle}>loading…</p></VtPanel></AppShell>;

  if (view === 'signed-out') {
    return (
      <AppShell section="Wallets">
        <VtPanel>
          <VtEyebrow>transaction history</VtEyebrow>
          <h1 style={titleStyle}>sign in first</h1>
          <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
        </VtPanel>
      </AppShell>
    );
  }

  return (
    <AppShell
      section="Wallets" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <VtEyebrow>wallets</VtEyebrow>
        <h1 style={titleStyle}>transaction history</h1>
        {error && <VtErrorText>{error}</VtErrorText>}

        {txs.length === 0 ? (
          <p style={subStyle}>nothing yet — deposits and withdrawals will show up here.</p>
        ) : (
          <div style={{ borderTop: `1px solid ${vtLine}` }}>
            {txs.map((t) => (
              <div
                key={`${t.txid}-${t.direction}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '11px 2px', borderBottom: `1px solid ${vtLine}`, position: 'relative', paddingLeft: 12,
                }}
              >
                <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: t.direction === 'in' ? vtSage : vtGold }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: vtMono, fontSize: 12.5, color: vtInk }}>
                    {t.direction === 'in' ? '↓ received' : '↑ sent'} · {t.asset.replace('_', ' ')}
                  </div>
                  <div style={{
                    fontFamily: vtMono, fontSize: 10.5, color: vtInkDim,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280,
                  }}>
                    {t.txid}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: vtMono, fontSize: 12.5, color: vtGold }}>
                    {fromBaseUnits(t.amount, ASSET_DECIMALS[t.asset] ?? 8)}
                  </div>
                  <div style={{
                    fontFamily: vtMono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em',
                    color: t.status === 'confirmed' ? vtSage : t.status === 'failed' ? vtErr : vtInkDim,
                  }}>
                    {t.status}{t.status === 'pending' ? ` (${t.confirmations})` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <a href="/wallets" style={{ fontFamily: vtMono, fontSize: 12.5, color: vtGold, textDecoration: 'underline' }}>
            ← back to wallets
          </a>
        </div>
      </VtPanel>
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700,
  color: vtInk, margin: '0 0 10px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };
