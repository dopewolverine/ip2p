'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtErrorText, VtSmallButton } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtLine, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { MarketNav } from '@/components/MarketNav';
import { getIncomingTrades, acceptTrade, declineTrade, IncomingTrade } from '@/lib/api/marketplace';
import { ApiError } from '@/lib/api/client';

export default function VendorInboxPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [trades, setTrades] = useState<IncomingTrade[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await getIncomingTrades();
      setTrades(res.trades);
    } catch {
      setError('could not load incoming trade requests.');
    }
  };

  useEffect(() => {
    me().then(() => { setSignedIn(true); load(); }).catch(() => setSignedIn(false));
  }, []);

  const handleAccept = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await acceptTrade(id);
      setMessage('accepted — escrow setup starts next (each party submits a key from their wallet).');
      setTrades((t) => t.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? (e.body?.message ?? 'could not accept this trade.') : 'could not reach the server.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await declineTrade(id);
      setTrades((t) => t.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? (e.body?.message ?? 'could not decline this trade.') : 'could not reach the server.');
    } finally {
      setBusyId(null);
    }
  };

  if (signedIn === false) {
    return (
      <AppShell section="Marketplace"><VtPanel>
        <VtEyebrow>trade requests</VtEyebrow>
        <h1 style={titleStyle}>sign in first</h1>
        <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
      </VtPanel></AppShell>
    );
  }

  const walletSession = useWalletSession();

  return (
    <AppShell
      section="Marketplace" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <VtEyebrow>trade requests</VtEyebrow>
          <MarketNav />
        </div>
        <h1 style={titleStyle}>waiting on your response</h1>
        {error && <VtErrorText>{error}</VtErrorText>}
        {message && <div style={{ fontFamily: vtMono, fontSize: 12, color: vtSage, marginBottom: 14 }}>{message}</div>}

        {trades.length === 0 ? (
          <p style={subStyle}>nothing waiting right now.</p>
        ) : (
          <div style={{ borderTop: `1px solid ${vtLine}` }}>
            {trades.map((t) => (
              <div key={t.id} style={{ padding: '13px 2px', borderBottom: `1px solid ${vtLine}`, position: 'relative', paddingLeft: 12 }}>
                <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: vtGold }} />
                <a href={`/trades/${t.id}`} style={{ fontFamily: vtMono, fontSize: 13, color: vtInk, textDecoration: 'none' }}>
                  $ {t.reference} — {t.asset.replace('_', ' ')}
                </a>
                <div style={{ fontFamily: vtMono, fontSize: 11.5, color: vtGold, marginTop: 2 }}>
                  {t.fiat_amount} for {t.amount} {t.asset.replace(/_.*/, '')} at {t.price_snapshot}
                </div>
                <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, marginTop: 4 }}>
                  {t.payment_window_hours}h payment window · requested {new Date(t.created_at).toLocaleString()}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <VtSmallButton onClick={() => handleAccept(t.id)} disabled={busyId === t.id}>accept</VtSmallButton>
                  <VtSmallButton onClick={() => handleDecline(t.id)} disabled={busyId === t.id} muted>decline</VtSmallButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </VtPanel>
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700, color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, lineHeight: 1.6 };
