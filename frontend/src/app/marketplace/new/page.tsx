'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import {
  createOffer, getAssets, getCountries, getCurrencies, getPaymentMethods,
  AssetRef, CountryRef, CurrencyRef, PaymentMethodRef,
} from '@/lib/api/marketplace';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { MarketNav } from '@/components/MarketNav';
import { ApiError } from '@/lib/api/client';

export default function NewOfferPage() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [countries, setCountries] = useState<CountryRef[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyRef[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRef[]>([]);

  const [side, setSide] = useState<'buy' | 'sell'>('sell');
  const [assetSlug, setAssetSlug] = useState('');
  const [countrySlug, setCountrySlug] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [paymentMethodSlug, setPaymentMethodSlug] = useState('');
  const [priceType, setPriceType] = useState<'fixed' | 'margin'>('fixed');
  const [price, setPrice] = useState('');
  const [marginPercent, setMarginPercent] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [totalAvailable, setTotalAvailable] = useState('');
  const [terms, setTerms] = useState('');
  const [paymentWindowHours, setPaymentWindowHours] = useState('24');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    me().then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    Promise.all([getAssets(), getCountries(), getCurrencies(), getPaymentMethods()]).then(
      ([a, c, cur, pm]) => {
        setAssets(a.assets);
        setCountries(c.countries);
        setCurrencies(cur.currencies);
        setPaymentMethods(pm.payment_methods);
        if (a.assets[0]) setAssetSlug(a.assets[0].slug);
        if (c.countries[0]) setCountrySlug(c.countries[0].slug);
        if (cur.currencies[0]) setCurrencyCode(cur.currencies[0].code);
        if (pm.payment_methods[0]) setPaymentMethodSlug(pm.payment_methods[0].slug);
      }
    );
  }, []);

  const valid = assetSlug && countrySlug && currencyCode && paymentMethodSlug
    && minAmount && maxAmount && totalAvailable && paymentWindowHours
    && (priceType === 'fixed' ? !!price : !!marginPercent);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await createOffer({
        side, asset_slug: assetSlug, country_slug: countrySlug, fiat_currency_code: currencyCode,
        payment_method_slug: paymentMethodSlug, price_type: priceType,
        price: priceType === 'fixed' ? price : undefined,
        margin_percent: priceType === 'margin' ? marginPercent : undefined,
        min_amount: minAmount, max_amount: maxAmount, total_available: totalAvailable,
        terms: terms || undefined, payment_window_hours: Number(paymentWindowHours),
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? (e.body?.message ?? 'could not create the offer.') : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  if (signedIn === false) {
    return (
      <AppShell section="Marketplace"><VtPanel>
        <VtEyebrow>new offer</VtEyebrow>
        <h1 style={titleStyle}>sign in first</h1>
        <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
      </VtPanel></AppShell>
    );
  }

  if (done) {
    return (
      <AppShell section="Marketplace"><VtPanel>
        <VtEyebrow>offer created</VtEyebrow>
        <h1 style={titleStyle}>your offer is live</h1>
        <a href="/marketplace" style={{ textDecoration: 'none' }}><VtButton>view marketplace</VtButton></a>
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
          <VtEyebrow>new offer</VtEyebrow>
          <MarketNav />
        </div>
        <h1 style={titleStyle}>create an offer</h1>

        <Row>
          <Field label="side">
            <select value={side} onChange={(e) => setSide(e.target.value as any)} style={selectStyle}>
              <option value="sell">i'm selling crypto</option>
              <option value="buy">i'm buying crypto</option>
            </select>
          </Field>
          <Field label="asset">
            <select value={assetSlug} onChange={(e) => setAssetSlug(e.target.value)} style={selectStyle}>
              {assets.map((a) => <option key={a.slug} value={a.slug}>{a.symbol}</option>)}
            </select>
          </Field>
        </Row>

        <Row>
          <Field label="country">
            <select value={countrySlug} onChange={(e) => setCountrySlug(e.target.value)} style={selectStyle}>
              {countries.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="currency">
            <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} style={selectStyle}>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </Row>

        <Field label="payment method">
          <select value={paymentMethodSlug} onChange={(e) => setPaymentMethodSlug(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
            {paymentMethods.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </Field>

        <Row>
          <Field label="price type">
            <select value={priceType} onChange={(e) => setPriceType(e.target.value as any)} style={selectStyle}>
              <option value="fixed">fixed price</option>
              <option value="margin">market + margin</option>
            </select>
          </Field>
          {priceType === 'fixed' ? (
            <VtTextField label="price" value={price} onChange={(e) => setPrice(e.target.value)} />
          ) : (
            <VtTextField label="margin % (e.g. 2.5 or -1)" value={marginPercent} onChange={(e) => setMarginPercent(e.target.value)} />
          )}
        </Row>

        <Row>
          <VtTextField label={`min amount (${currencyCode})`} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          <VtTextField label={`max amount (${currencyCode})`} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
        </Row>

        <Row>
          <VtTextField label="total available (whole coins, e.g. 0.5 BTC)" value={totalAvailable} onChange={(e) => setTotalAvailable(e.target.value)} />
          <VtTextField label="payment window (hours)" value={paymentWindowHours} onChange={(e) => setPaymentWindowHours(e.target.value)} />
        </Row>

        <VtTextField label="terms (optional)" value={terms} onChange={(e) => setTerms(e.target.value)} />

        {error && <VtErrorText>{error}</VtErrorText>}
        <VtButton disabled={!valid || busy} onClick={submit}>
          {busy ? 'creating…' : 'create offer'}
        </VtButton>
      </VtPanel>
    </AppShell>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12 }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, marginBottom: 16 }}>
      <div style={{ fontFamily: vtMono, fontSize: 11, color: vtInkDim, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700, color: vtInk, margin: '0 0 18px', textTransform: 'lowercase',
};
const selectStyle: React.CSSProperties = {
  width: '100%', padding: '9px 10px', fontFamily: vtMono, fontSize: 12.5, color: vtInk,
  background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 5, boxSizing: 'border-box',
};
