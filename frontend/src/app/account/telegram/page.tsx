'use client';

import React, { useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtErrorText, VtSmallLink } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { requestTelegramLinkToken, unlinkTelegram } from '@/lib/api/notifications';
import { logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { ApiError } from '@/lib/api/client';

export default function TelegramLinkPage() {
  const walletSession = useWalletSession();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await requestTelegramLinkToken();
      setToken(res.token);
    } catch (e) {
      setError(e instanceof ApiError ? 'could not generate a link code.' : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setError(null);
    try {
      await unlinkTelegram();
      setToken(null);
    } catch {
      setError('could not unlink.');
    }
  };

  return (
    <AppShell
      section="Telegram" accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <VtEyebrow>telegram notifications</VtEyebrow>
        <h1 style={titleStyle}>link telegram</h1>
        <p style={subStyle}>
          this only delivers notifications — it can never be used to log in, and nothing about your
          account can be done from telegram.
        </p>

        {error && <VtErrorText>{error}</VtErrorText>}

        {token ? (
          <>
            <div style={{
              fontFamily: vtMono, fontSize: 16, letterSpacing: '0.05em', color: vtGold, background: vtSurfaceDeep,
              border: `1px solid ${vtLine}`, borderRadius: 5, padding: '14px', textAlign: 'center', marginBottom: 12,
            }}>
              {token}
            </div>
            <p style={{ ...subStyle, fontSize: 11 }}>
              send this code to the ip2p bot on telegram within 10 minutes to finish linking.
            </p>
          </>
        ) : (
          <VtButton disabled={busy} onClick={generate}>
            {busy ? 'generating…' : 'generate link code'}
          </VtButton>
        )}

        <div style={{ marginTop: 16 }}>
          <VtSmallLink onClick={unlink}>unlink telegram</VtSmallLink>
        </div>
      </VtPanel>
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700,
  color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };
