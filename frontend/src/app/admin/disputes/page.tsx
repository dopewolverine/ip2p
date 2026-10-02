'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton } from '@/components/vtUi';
import { vtInk, vtInkDim, vtErr, vtLine, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { getDisputes, DisputeListItem } from '@/lib/api/adminDisputes';

export default function DisputeQueuePage() {
  const walletSession = useWalletSession();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [disputes, setDisputes] = useState<DisputeListItem[]>([]);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    me().then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    getDisputes().then((r) => setDisputes(r.disputes)).catch((e) => {
      if (e?.status === 403) setForbidden(true);
    });
  }, []);

  if (signedIn === false) {
    return (
      <AppShell section="Admin"><VtPanel>
        <VtEyebrow>disputes</VtEyebrow>
        <h1 style={titleStyle}>sign in first</h1>
        <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
      </VtPanel></AppShell>
    );
  }

  if (forbidden) {
    return <AppShell section="Admin"><VtPanel><VtEyebrow>disputes</VtEyebrow><p style={subStyle}>staff or owner access only.</p></VtPanel></AppShell>;
  }

  return (
    <AppShell
      section="Admin" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <VtEyebrow>open disputes</VtEyebrow>
        {disputes.length === 0 ? (
          <p style={subStyle}>nothing open right now.</p>
        ) : (
          <div style={{ borderTop: `1px solid ${vtLine}` }}>
            {disputes.map((d) => (
              <a
                key={d.contract_id}
                href={`/admin/disputes/${d.contract_id}`}
                style={{ display: 'block', padding: '11px 2px', borderBottom: `1px solid ${vtLine}`, textDecoration: 'none' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: vtMono, fontSize: 13, color: vtInk }}>
                    $ {d.reference} — {d.asset.replace('_', ' ')}
                  </span>
                  {d.escalated_at && (
                    <span style={{ fontFamily: vtMono, fontSize: 9.5, color: vtErr, textTransform: 'uppercase' }}>escalated</span>
                  )}
                </div>
                <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, marginTop: 2 }}>
                  {d.reason_code} · opened {new Date(d.opened_at).toLocaleString()}
                  {d.staff_recommendation ? ` · recommended: ${d.staff_recommendation}` : ''}
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
