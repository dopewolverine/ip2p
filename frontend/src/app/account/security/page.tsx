'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText, VtStamp } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { deriveStepupVerifier } from '@/lib/crypto/stepup';
import { me, logout, totpSetup, totpEnable, totpDisableRequest, MeResponse } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { ApiError } from '@/lib/api/client';

type View = 'loading' | 'signed-out' | 'overview' | 'enabling' | 'enabled-codes' | 'disabling' | 'disable-scheduled';

export default function SecurityPage() {
  const walletSession = useWalletSession();
  const [view, setView] = useState<View>('loading');
  const [account, setAccount] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [setupToken, setSetupToken] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [enableCode, setEnableCode] = useState('');
  const [enablePassword, setEnablePassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const [disableCode, setDisableCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');

  useEffect(() => {
    me()
      .then((res) => { setAccount(res); setView('overview'); })
      .catch(() => setView('signed-out'));
  }, []);

  const startEnable = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await totpSetup();
      setSetupToken(res.setup_token);
      setSecret(res.secret);
      setOtpauthUrl(res.otpauth_url);
      setView('enabling');
    } catch {
      setError('could not start setup. try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    setError(null);
    if (!account || !enableCode || !enablePassword) return;
    setBusy(true);
    try {
      const verifier = await deriveStepupVerifier(account.username, enablePassword);
      const res = await totpEnable(setupToken, enableCode, verifier);
      setRecoveryCodes(res.recovery_codes);
      setView('enabled-codes');
    } catch (e) {
      setError(e instanceof ApiError ? humanizeError(e) : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const submitDisable = async () => {
    setError(null);
    if (!account || !disableCode || !disablePassword) return;
    setBusy(true);
    try {
      const verifier = await deriveStepupVerifier(account.username, disablePassword);
      const res = await totpDisableRequest(disableCode, verifier);
      setEffectiveAt(res.effective_at);
      setView('disable-scheduled');
    } catch (e) {
      setError(e instanceof ApiError ? humanizeError(e) : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  if (view === 'loading') return <AppShell section="Accounts & Keys"><VtPanel><p style={subStyle}>loading…</p></VtPanel></AppShell>;

  if (view === 'signed-out') {
    return (
      <AppShell section="Accounts & Keys">
        <VtPanel>
          <VtEyebrow>account security</VtEyebrow>
          <h1 style={titleStyle}>sign in first</h1>
          <p style={subStyle}>you need to be logged in to manage two-factor authentication.</p>
          <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
        </VtPanel>
      </AppShell>
    );
  }
  return (
    <AppShell
      section="Accounts & Keys" accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      {view === 'overview' && account && (
        <VtPanel>
          <VtEyebrow>account security — {account.username}</VtEyebrow>
          <h1 style={titleStyle}>two-factor authentication</h1>
          <p style={subStyle}>
            {account.totp_enabled
              ? 'two-factor authentication is currently on for this account.'
              : 'two-factor authentication is currently off. turning it on requires an authenticator app.'}
          </p>
          {account.totp_enabled ? (
            <VtButton onClick={() => setView('disabling')}>disable two-factor</VtButton>
          ) : (
            <VtButton disabled={busy} onClick={startEnable}>
              {busy ? 'working…' : 'enable two-factor'}
            </VtButton>
          )}
        </VtPanel>
      )}

      {view === 'enabling' && (
        <VtPanel>
          <VtEyebrow>enable two-factor</VtEyebrow>
          <h1 style={titleStyle}>scan or enter this key</h1>
          <p style={subStyle}>add this to your authenticator app (aegis, authy, google authenticator, ...).</p>
          <div style={{
            fontFamily: vtMono, fontSize: 13, color: vtGold, background: vtSurfaceDeep, border: `1px solid ${vtLine}`,
            borderRadius: 5, padding: '12px 14px', marginBottom: 8, wordBreak: 'break-all',
          }}>
            {secret}
          </div>
          <p style={{ ...subStyle, fontSize: 11, opacity: 0.7 }}>
            manual entry key — most apps also accept the otpauth:// uri directly if you paste it into an "add by url" option.
          </p>
          <VtTextField label="code from your app" inputMode="numeric" maxLength={6} value={enableCode} onChange={(e) => setEnableCode(e.target.value)} />
          <VtTextField label="your password" type="password" value={enablePassword} onChange={(e) => setEnablePassword(e.target.value)} />
          {error && <VtErrorText>{error}</VtErrorText>}
          <VtButton disabled={busy} onClick={confirmEnable}>
            {busy ? 'verifying…' : 'turn on two-factor'}
          </VtButton>
        </VtPanel>
      )}

      {view === 'enabled-codes' && (
        <VtPanel>
          <VtEyebrow>two-factor enabled</VtEyebrow>
          <h1 style={titleStyle}>save your recovery codes</h1>
          <VtStamp>shown once<br />write these down</VtStamp>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20,
            fontFamily: vtMono, fontSize: 12.5, color: vtInk,
          }}>
            {recoveryCodes.map((c) => (
              <div key={c} style={{ background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 4, padding: '8px 10px' }}>{c}</div>
            ))}
          </div>
          <p style={subStyle}>each code works once, if you ever lose access to your authenticator app.</p>
          <VtButton onClick={() => setView('overview')}>done</VtButton>
        </VtPanel>
      )}

      {view === 'disabling' && (
        <VtPanel>
          <VtEyebrow>disable two-factor</VtEyebrow>
          <h1 style={titleStyle}>confirm it's you</h1>
          <p style={subStyle}>disabling takes effect 48 hours after this request, and we'll email you.</p>
          <VtTextField label="current code" inputMode="numeric" maxLength={6} value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
          <VtTextField label="your password" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} />
          {error && <VtErrorText>{error}</VtErrorText>}
          <VtButton disabled={busy} onClick={submitDisable}>
            {busy ? 'working…' : 'request disable'}
          </VtButton>
        </VtPanel>
      )}

      {view === 'disable-scheduled' && (
        <VtPanel>
          <VtEyebrow>scheduled</VtEyebrow>
          <h1 style={titleStyle}>disable scheduled</h1>
          <p style={subStyle}>
            two-factor will turn off at {new Date(effectiveAt).toLocaleString()}. log in again before
            then to cancel this if it wasn't you.
          </p>
          <VtButton onClick={() => setView('overview')}>back to security</VtButton>
        </VtPanel>
      )}
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700,
  color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };

function humanizeError(e: ApiError): string {
  const map: Record<string, string> = {
    invalid_password: 'wrong password.',
    invalid_code: 'that code is incorrect.',
    invalid_or_expired_setup: 'that setup session expired. start again.',
    totp_already_enabled: 'two-factor is already on.',
    totp_not_enabled: 'two-factor is not currently on.',
  };
  return map[e.body?.error] ?? 'something went wrong. try again.';
}
