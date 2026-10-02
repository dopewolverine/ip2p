'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText, VtStamp } from '@/components/vtUi';
import { vtInk, vtInkDim, vtErr, vtMono } from '@/components/vtTokens';
import { deriveStepupVerifier } from '@/lib/crypto/stepup';
import { me, logout, accountDeleteRequest, MeResponse } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { ApiError } from '@/lib/api/client';

type View = 'loading' | 'signed-out' | 'confirm' | 'done';

export default function DeleteAccountPage() {
  const walletSession = useWalletSession();
  const [view, setView] = useState<View>('loading');
  const [account, setAccount] = useState<MeResponse | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState('');

  useEffect(() => {
    me().then((res) => { setAccount(res); setView('confirm'); }).catch(() => setView('signed-out'));
  }, []);

  const submit = async () => {
    setError(null);
    if (!account || !password) return;
    if (account.totp_enabled && !code) { setError('enter your current 2FA code.'); return; }

    setBusy(true);
    try {
      const verifier = await deriveStepupVerifier(account.username, password);
      const res = await accountDeleteRequest(verifier, account.totp_enabled ? code : undefined);
      setDueAt(res.deletion_due_at);
      setView('done');
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
          <VtEyebrow>delete account</VtEyebrow>
          <h1 style={titleStyle}>sign in first</h1>
          <p style={subStyle}>you need to be logged in to delete your account.</p>
          <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
        </VtPanel>
      </AppShell>
    );
  }

  if (view === 'done') {
    return (
      <AppShell section="Accounts & Keys">
        <VtPanel>
          <VtEyebrow>deletion scheduled</VtEyebrow>
          <h1 style={titleStyle}>account scheduled for deletion</h1>
          <VtStamp color={vtErr}>due<br />{new Date(dueAt).toLocaleDateString()}</VtStamp>
          <p style={{ ...subStyle, textAlign: 'center' }}>
            logging in any time before then cancels this automatically. your wallets stay recoverable
            even after deletion — only your account details are removed.
          </p>
        </VtPanel>
      </AppShell>
    );
  }

  return (
    <AppShell
      section="Accounts & Keys" accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <VtEyebrow>delete account — {account?.username}</VtEyebrow>
        <h1 style={titleStyle}>this starts a 7-day countdown</h1>
        <p style={subStyle}>
          your account deactivates in 7 days. logging in before then cancels it. your wallets are
          never deleted — you can still recover them with your seed phrase afterward.
        </p>
        <VtTextField label="your password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {account?.totp_enabled && (
          <VtTextField label="current 2FA code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        )}
        {error && <VtErrorText>{error}</VtErrorText>}
        <VtButton disabled={busy || !password} onClick={submit}>
          {busy ? 'working…' : 'request account deletion'}
        </VtButton>
      </VtPanel>
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
    totp_code_required: 'enter your current 2FA code.',
    deletion_already_requested: 'deletion is already scheduled for this account.',
  };
  return map[e.body?.error] ?? 'something went wrong. try again.';
}
