'use client';

import React, { useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtMono } from '@/components/vtTokens';
import { passwordResetRequest } from '@/lib/api/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await passwordResetRequest(email);
      setSent(true);
    } catch {
      setError('could not reach the server. try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell section="Accounts & Keys">
      <VtPanel>
        <VtEyebrow>password reset</VtEyebrow>
        <h1 style={titleStyle}>reset your password</h1>
        {sent ? (
          <p style={subStyle}>
            if an account exists for that email, a reset link is on its way. it expires in 30 minutes.
          </p>
        ) : (
          <>
            <p style={subStyle}>
              this recovers your account, not your crypto. if you have your recovery phrase,{' '}
              <a href="/reset-password" style={{ color: vtGold }}>use it during reset</a> to keep your wallets too.
            </p>
            <VtTextField label="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <VtErrorText>{error}</VtErrorText>}
            <VtButton disabled={busy || !email} onClick={submit}>
              {busy ? 'working…' : 'send reset link'}
            </VtButton>
          </>
        )}
      </VtPanel>
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700,
  color: vtInk, margin: '0 0 14px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };
