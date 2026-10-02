'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtErr, vtLine, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { getTickets, Ticket } from '@/lib/api/tickets';
import { ApiError } from '@/lib/api/client';

export default function AdminTicketsPage() {
  const walletSession = useWalletSession();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    me().then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    getTickets(true).then((r) => setTickets(r.tickets)).catch((e) => {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
    });
  }, []);

  if (signedIn === false) {
    return (
      <AppShell section="Admin"><VtPanel>
        <VtEyebrow>tickets</VtEyebrow>
        <h1 style={titleStyle}>sign in first</h1>
        <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
      </VtPanel></AppShell>
    );
  }

  if (forbidden) {
    return <AppShell section="Admin"><VtPanel><VtEyebrow>tickets</VtEyebrow><p style={subStyle}>staff or owner access only.</p></VtPanel></AppShell>;
  }

  return (
    <AppShell
      section="Admin" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <VtEyebrow>all tickets</VtEyebrow>
        {tickets.length === 0 ? (
          <p style={subStyle}>nothing open right now.</p>
        ) : (
          <div style={{ borderTop: `1px solid ${vtLine}` }}>
            {tickets.map((t) => (
              <a
                key={t.id}
                href={`/tickets/${t.id}`}
                style={{ display: 'block', padding: '12px 2px', borderBottom: `1px solid ${vtLine}`, textDecoration: 'none', position: 'relative', paddingLeft: 12 }}
              >
                <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: t.status === 'open' ? vtErr : vtGold }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: vtMono, fontSize: 12.5, color: vtInk }}>$ {t.subject}</span>
                  <span style={{
                    fontFamily: vtMono, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em',
                    color: t.status === 'open' ? vtGold : vtInkDim, border: `1px solid ${vtLine}`, borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap',
                  }}>
                    {t.status}
                  </span>
                </div>
                <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, marginTop: 4 }}>
                  from {t.username ?? 'unknown'} · {t.assigned_staff_id ? 'assigned' : 'unassigned'} · updated {new Date(t.updated_at).toLocaleString()}
                </div>
              </a>
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
