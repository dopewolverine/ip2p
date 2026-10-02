'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtLine, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { getTickets, Ticket } from '@/lib/api/tickets';

export default function TicketsPage() {
  const walletSession = useWalletSession();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    me().then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    getTickets().then((r) => setTickets(r.tickets)).catch(() => {});
  }, []);

  if (signedIn === false) {
    return (
      <AppShell section="Support"><VtPanel>
        <VtEyebrow>support</VtEyebrow>
        <h1 style={titleStyle}>sign in first</h1>
        <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
      </VtPanel></AppShell>
    );
  }

  return (
    <AppShell
      section="Support" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <VtEyebrow>support</VtEyebrow>
          <a href="/tickets/new" style={{ fontFamily: vtMono, fontSize: 11.5, color: vtGold, textDecoration: 'underline' }}>
            new ticket
          </a>
        </div>

        {tickets.length === 0 ? (
          <p style={subStyle}>no tickets yet.</p>
        ) : (
          <div style={{ borderTop: `1px solid ${vtLine}` }}>
            {tickets.map((t) => (
              <a
                key={t.id}
                href={`/tickets/${t.id}`}
                style={{
                  display: 'block', padding: '11px 2px', borderBottom: `1px solid ${vtLine}`, textDecoration: 'none',
                }}
              >
                <div style={{ fontFamily: vtMono, fontSize: 13, color: vtInk }}>$ {t.subject}</div>
                <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, marginTop: 2 }}>
                  {t.status} · {new Date(t.updated_at).toLocaleString()}
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
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, lineHeight: 1.6 };
