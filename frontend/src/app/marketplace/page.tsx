'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtTextField, VtErrorText, VtSmallButton } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { browseOffers, requestTrade, OfferListItem } from '@/lib/api/marketplace';
import { ReputationBadge } from '@/components/ReputationBadge';
import { MarketNav } from '@/components/MarketNav';
import { logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { ApiError } from '@/lib/api/client';

function assetLabel(symbol: string): string {
  const map: Record<string, string> = {
    USDT_ERC20: 'USDT (ERC20)', USDC_ERC20: 'USDC (ERC20)', USDT_TRC20: 'USDT (TRC20)',
  };
  return map[symbol] ?? symbol;
}

export default function MarketplacePage() {
  const [offers, setOffers] = useState<OfferListItem[]>([]);
  const [side, setSide] = useState('');
  const [asset, setAsset] = useState('');
  const [sort, setSort] = useState('price_asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [requestResult, setRequestResult] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await browseOffers({ side: side || undefined, asset: asset || undefined, sort });
      setOffers(res.offers);
    } catch {
      setError('could not load offers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [side, asset, sort]);

  const submitRequest = async (offerId: string) => {
    setError(null);
    try {
      const res = await requestTrade(offerId, amount);
      setRequestResult(`trade requested — reference ${res.reference}. waiting on the vendor to accept.`);
      setRequestingId(null);
      setAmount('');
    } catch (e) {
      setError(e instanceof ApiError ? humanizeError(e) : 'could not reach the server.');
    }
  };

  const walletSession = useWalletSession();

  return (
    <AppShell
      section="Marketplace" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <VtEyebrow>browse offers</VtEyebrow>
          <MarketNav />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 18, flexWrap: 'wrap' }}>
          <select value={side} onChange={(e) => setSide(e.target.value)} style={selectStyle}>
            <option value="">any side</option>
            <option value="sell">vendor selling crypto</option>
            <option value="buy">vendor buying crypto</option>
          </select>
          <select value={asset} onChange={(e) => setAsset(e.target.value)} style={selectStyle}>
            <option value="">any asset</option>
            <option value="bitcoin">BTC</option>
            <option value="litecoin">LTC</option>
            <option value="ethereum">ETH</option>
            <option value="usdt-erc20">USDT (ERC20)</option>
            <option value="usdc-erc20">USDC (ERC20)</option>
            <option value="usdt-trc20">USDT (TRC20)</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={selectStyle}>
            <option value="price_asc">price ↑</option>
            <option value="price_desc">price ↓</option>
            <option value="completion_rate">completion rate</option>
            <option value="release_time">fastest release</option>
          </select>
        </div>
        {error && <VtErrorText>{error}</VtErrorText>}
        {requestResult && (
          <div style={{ fontFamily: vtMono, fontSize: 12, color: vtSage, marginBottom: 14 }}>{requestResult}</div>
        )}

        {loading ? (
          <p style={subStyle}>loading…</p>
        ) : offers.length === 0 ? (
          <p style={subStyle}>no offers match right now.</p>
        ) : (
          <div style={{ borderTop: `1px solid ${vtLine}` }}>
            {offers.map((o) => (
              <div key={o.id} style={{ padding: '13px 2px', borderBottom: `1px solid ${vtLine}`, position: 'relative', paddingLeft: 12 }}>
                <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: o.side === 'sell' ? vtGold : vtSage }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: vtMono, fontSize: 13, color: vtInk }}>
                      $ {o.side === 'sell' ? 'selling' : 'buying'} {assetLabel(o.asset_symbol)}
                    </div>
                    <div style={{ fontFamily: vtMono, fontSize: 12, color: vtGold, marginTop: 2 }}>
                      {o.current_price !== null
                        ? `${o.current_price.toFixed(o.decimal_places)} ${o.currency_code} / ${o.asset_symbol.replace(/_.*/, '')}`
                        : 'price unavailable'}
                    </div>
                    <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, marginTop: 4 }}>
                      limits: {o.min_amount}–{o.max_amount} {o.currency_code} · {o.payment_method_name} · {o.payment_window_hours}h window
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <ReputationBadge reputation={o.vendor_reputation} />
                    </div>
                  </div>
                  <VtSmallButton onClick={() => setRequestingId(requestingId === o.id ? null : o.id)} muted={requestingId === o.id}>
                    {requestingId === o.id ? 'cancel' : 'request trade'}
                  </VtSmallButton>
                </div>

                {requestingId === o.id && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${vtLine}` }}>
                    <VtTextField label={`amount (${o.currency_code})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <VtSmallButton onClick={() => submitRequest(o.id)} disabled={!amount}>
                      confirm request
                    </VtSmallButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </VtPanel>
    </AppShell>
  );
}

const selectStyle: React.CSSProperties = {
  flex: 1, padding: '9px 10px', fontFamily: vtMono, fontSize: 12.5, color: vtInk,
  background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 5, minWidth: 110,
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, lineHeight: 1.6 };

function humanizeError(e: ApiError): string {
  const map: Record<string, string> = {
    offer_not_active: 'this offer is no longer active.',
    cannot_request_own_offer: "you can't request your own offer.",
    amount_out_of_range: "that amount is outside this offer's limits.",
    price_unavailable: 'this offer\u2019s price feed is currently unavailable.',
    exceeds_total_available: "that would exceed the vendor's available amount.",
  };
  return map[e.body?.error] ?? 'could not request this trade.';
}
