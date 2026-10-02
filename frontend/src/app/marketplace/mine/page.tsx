'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtErrorText, VtSmallButton } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtLine, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { MarketNav } from '@/components/MarketNav';
import { getMyOffers, pauseOffer, withdrawOffer, reactivateOffer, MyOffer } from '@/lib/api/marketplace';
import { ApiError } from '@/lib/api/client';

export default function MyOffersPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => getMyOffers().then((r) => setOffers(r.offers)).catch(() => {});

  useEffect(() => {
    me().then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    load();
  }, []);

  const act = async (id: string, action: 'pause' | 'withdraw' | 'reactivate') => {
    setError(null);
    setBusyId(id);
    try {
      if (action === 'pause') await pauseOffer(id);
      if (action === 'withdraw') await withdrawOffer(id);
      if (action === 'reactivate') await reactivateOffer(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? 'could not update that offer.' : 'could not reach the server.');
    } finally {
      setBusyId(null);
    }
  };

  if (signedIn === false) {
    return (
      <AppShell section="Marketplace"><VtPanel>
        <VtEyebrow>my offers</VtEyebrow>
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
          <VtEyebrow>my offers</VtEyebrow>
          <MarketNav />
        </div>

        {error && <VtErrorText>{error}</VtErrorText>}

        {offers.length === 0 ? (
          <p style={subStyle}>you haven't created any offers yet.</p>
        ) : (
          <div style={{ borderTop: `1px solid ${vtLine}` }}>
            {offers.map((o) => (
              <div key={o.id} style={{ padding: '13px 2px', borderBottom: `1px solid ${vtLine}`, position: 'relative', paddingLeft: 12 }}>
                <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: o.status === 'active' ? vtGold : vtInkDim }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: vtMono, fontSize: 13, color: vtInk }}>
                      $ {o.side === 'sell' ? 'selling' : 'buying'} {o.asset_symbol.replace('_', ' ')}
                    </div>
                    <div style={{ fontFamily: vtMono, fontSize: 11, color: vtInkDim, marginTop: 2 }}>
                      {o.price_type === 'fixed' ? o.price : `market + ${o.margin_percent}%`} {o.currency_code}
                    </div>
                    <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, marginTop: 4 }}>
                      limits: {o.min_amount}–{o.max_amount} {o.currency_code} · {o.payment_method_name}
                    </div>
                    <div style={{
                      fontFamily: vtMono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em',
                      color: o.status === 'active' ? vtGold : vtInkDim, marginTop: 4,
                    }}>
                      {o.status}{o.paused_reason ? ` — ${o.paused_reason}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {o.status === 'active' && (
                      <VtSmallButton onClick={() => act(o.id, 'pause')} disabled={busyId === o.id} muted>pause</VtSmallButton>
                    )}
                    {o.status === 'paused' && (
                      <VtSmallButton onClick={() => act(o.id, 'reactivate')} disabled={busyId === o.id}>reactivate</VtSmallButton>
                    )}
                    {o.status !== 'withdrawn' && (
                      <VtSmallButton onClick={() => act(o.id, 'withdraw')} disabled={busyId === o.id} muted>withdraw</VtSmallButton>
                    )}
                  </div>
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
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim };
