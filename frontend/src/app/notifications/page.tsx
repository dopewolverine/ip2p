'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtErr, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import {
  getNotifications, markNotificationRead, getPreferences, updatePreferences,
  NotificationEntry, NotificationPreferences,
} from '@/lib/api/notifications';
import { ApiError } from '@/lib/api/client';

const TYPE_LABEL: Record<string, string> = {
  trade_requested: 'new trade request', trade_accepted: 'trade accepted', trade_declined: 'trade declined',
  trade_cancelled: 'trade cancelled', escrow_funded: 'escrow funded — send payment', payment_marked: 'payment marked as sent',
  timer_warning_50: 'trade window 50% elapsed', timer_warning_90: 'trade window closing soon', timer_expired: 'trade timed out',
  trade_released: 'trade released', dispute_opened: 'dispute opened', dispute_resolved: 'dispute resolved',
  dispute_escalated: 'dispute needs a decision', deposit_confirmed: 'deposit confirmed', withdrawal_confirmed: 'withdrawal confirmed',
  offer_auto_paused: 'offer paused', new_chat_message: 'new message',
  new_device_login: 'new device login', password_changed: 'password changed', totp_changed: 'two-factor changed',
  recovery_code_used: 'recovery code used', seed_recovery_used: 'account recovered with seed phrase',
};

export default function NotificationsPage() {
  const walletSession = useWalletSession();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [items, setItems] = useState<NotificationEntry[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    me().then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    getNotifications().then((r) => setItems(r.notifications)).catch(() => {});
    getPreferences().then(setPrefs).catch(() => {});
  }, []);

  const handleRead = async (id: string) => {
    await markNotificationRead(id).catch(() => {});
    setItems((its) => its.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  };

  const toggle = (key: keyof NotificationPreferences) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
    setSaved(false);
  };

  const savePrefs = async () => {
    setError(null);
    try {
      await updatePreferences(prefs);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? 'could not save preferences.' : 'could not reach the server.');
    }
  };

  if (signedIn === false) {
    return (
      <AppShell section="Notifications"><VtPanel>
        <VtEyebrow>notifications</VtEyebrow>
        <h1 style={titleStyle}>sign in first</h1>
        <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
      </VtPanel></AppShell>
    );
  }

  return (
    <AppShell
      section="Notifications" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <VtEyebrow>notifications</VtEyebrow>
        {items.length === 0 ? (
          <p style={subStyle}>nothing yet.</p>
        ) : (
          <div style={{ borderTop: `1px solid ${vtLine}` }}>
            {items.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read_at && handleRead(n.id)}
                style={{
                  padding: '11px 2px', borderBottom: `1px solid ${vtLine}`, position: 'relative', paddingLeft: 12,
                  cursor: n.read_at ? 'default' : 'pointer',
                }}
              >
                <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: n.read_at ? vtLine : vtGold }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: vtMono, fontSize: 12.5, color: n.read_at ? vtInkDim : vtInk }}>
                    {n.read_at ? '' : '$ '}{TYPE_LABEL[n.type] ?? n.type}
                  </span>
                  <span style={{
                    fontFamily: vtMono, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
                    color: n.priority === 'critical' || n.priority === 'security' ? vtErr : vtGold,
                  }}>
                    {n.priority}
                  </span>
                </div>
                <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, marginTop: 3 }}>
                  {new Date(n.created_at).toLocaleString()}
                  {n.payload?.reference ? ` · ${n.payload.reference}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </VtPanel>

      <div style={{ marginTop: 18 }}>
        <VtPanel>
          <VtEyebrow>preferences</VtEyebrow>
          <p style={{ ...subStyle, fontSize: 11, marginBottom: 16 }}>
            security notifications (new device, password changes, 2FA) always go to your email and can't be muted.
          </p>

          {(['critical', 'normal', 'low'] as const).map((tier) => (
            <div key={tier} style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: vtMono, fontSize: 11.5, color: vtGold, textTransform: 'uppercase', marginBottom: 6 }}>
                {tier}
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                {tier !== 'low' && (
                  <Toggle label="web" checked={prefs[`${tier}_web` as keyof NotificationPreferences] !== false} onChange={() => toggle(`${tier}_web` as keyof NotificationPreferences)} />
                )}
                {tier === 'low' && (
                  <Toggle label="web" checked={prefs.low_web !== false} onChange={() => toggle('low_web')} />
                )}
                {tier !== 'low' && (
                  <Toggle label="telegram" checked={prefs[`${tier}_telegram` as keyof NotificationPreferences] !== false} onChange={() => toggle(`${tier}_telegram` as keyof NotificationPreferences)} />
                )}
                {tier === 'critical' && (
                  <Toggle label="email" checked={prefs.critical_email !== false} onChange={() => toggle('critical_email')} />
                )}
              </div>
            </div>
          ))}

          {error && <VtErrorText>{error}</VtErrorText>}
          {saved && <div style={{ fontFamily: vtMono, fontSize: 12, color: vtSage, marginBottom: 10 }}>saved.</div>}
          <VtButton onClick={savePrefs}>save preferences</VtButton>
        </VtPanel>
      </div>
    </AppShell>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span style={{ fontFamily: vtMono, fontSize: 12, color: vtInk }}>{label}</span>
    </label>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700, color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, lineHeight: 1.6 };
