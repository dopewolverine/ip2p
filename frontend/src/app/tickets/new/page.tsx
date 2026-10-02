'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk } from '@/components/vtTokens';
import { createTicket } from '@/lib/api/tickets';
import { logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import { ApiError } from '@/lib/api/client';

export default function NewTicketPage() {
  const router = useRouter();
  const walletSession = useWalletSession();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await createTicket(subject, body);
      router.push(`/tickets/${res.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? 'could not create the ticket.' : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      section="Support" accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <VtEyebrow>support</VtEyebrow>
        <h1 style={titleStyle}>new ticket</h1>
        <VtTextField label="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <VtTextField label="describe the issue" value={body} onChange={(e) => setBody(e.target.value)} />
        {error && <VtErrorText>{error}</VtErrorText>}
        <VtButton disabled={!subject.trim() || !body.trim() || busy} onClick={submit}>
          {busy ? 'submitting…' : 'submit'}
        </VtButton>
      </VtPanel>
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700, color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
