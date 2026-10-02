'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtErrorText, VtSmallButton, VtSmallLink } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { me, logout, MeResponse } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import {
  getTicketMessages, getTicketDetail, replyToTicket, closeTicket, assignTicket, uploadTicketAttachment,
  TicketMessage, TicketDetail,
} from '@/lib/api/tickets';
import { attachmentUrl } from '@/lib/api/chat';
import { ApiError } from '@/lib/api/client';

export default function TicketThreadPage() {
  const { id } = useParams<{ id: string }>();
  const walletSession = useWalletSession();
  const [account, setAccount] = useState<MeResponse | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStaff = account?.role === 'staff' || account?.role === 'owner';

  const load = () => {
    getTicketMessages(id).then((r) => setMessages(r.messages)).catch(() => {});
    getTicketDetail(id).then(setTicket).catch(() => {});
  };

  useEffect(() => {
    me().then((res) => { setAccount(res); setSignedIn(true); }).catch(() => setSignedIn(false));
    load();
  }, [id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      await replyToTicket(id, draft);
      setDraft('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? 'could not send.' : 'could not reach the server.');
    }
  };

  const handleUpload = async (file: File) => {
    setError(null);
    setUploadBusy(true);
    try {
      await uploadTicketAttachment(id, file);
      await load();
    } catch {
      setError('could not upload that file — only images and PDF, up to 10MB.');
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAssign = async () => {
    setError(null);
    try {
      await assignTicket(id);
      await load();
    } catch {
      setError('could not assign this ticket.');
    }
  };

  if (signedIn === false) {
    return <AppShell section="Support"><VtPanel><VtEyebrow>support</VtEyebrow><p style={subStyle}>sign in first.</p></VtPanel></AppShell>;
  }
  return (
    <AppShell
      section="Support" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div>
            <VtEyebrow>ticket</VtEyebrow>
            {ticket && (
              <>
                <h1 style={titleStyle}>{ticket.subject}</h1>
                <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim }}>
                  filed by {ticket.username} · status: {ticket.status}
                  {ticket.assigned_staff_username ? ` · assigned to ${ticket.assigned_staff_username}` : ''}
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {isStaff && (
              <VtSmallButton onClick={handleAssign} muted>assign to me</VtSmallButton>
            )}
            <VtSmallLink onClick={() => closeTicket(id).then(load)}>close</VtSmallLink>
          </div>
        </div>
        {error && <VtErrorText>{error}</VtErrorText>}

        <div style={{ border: `1px solid ${vtLine}`, borderRadius: 5, background: vtSurfaceDeep, height: 320, overflowY: 'auto', padding: 14, marginBottom: 12 }}>
          {messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: vtMono, fontSize: 10, color: m.sender_type === 'staff' ? vtGold : vtInkDim, textTransform: 'uppercase', marginBottom: 2 }}>
                {m.sender_type} · {new Date(m.created_at).toLocaleTimeString()}
              </div>
              <div style={{ fontFamily: vtMono, fontSize: 12.5, color: vtInk }}>
                {m.body}
                {m.attachment_id && (
                  <div>
                    <a href={attachmentUrl(m.attachment_id)} target="_blank" rel="noreferrer" style={{ color: vtGold }}>
                      view attachment
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="reply…"
            style={{ flex: 1, padding: '9px 12px', fontFamily: vtMono, fontSize: 12.5, color: vtInk, background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 5 }}
          />
          <VtSmallButton onClick={send}>send</VtSmallButton>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            style={{ display: 'none' }}
            id="ticket-attach-input"
          />
          <label
            htmlFor="ticket-attach-input"
            style={{ fontFamily: vtMono, fontSize: 11.5, color: vtGold, textDecoration: 'underline', cursor: 'pointer' }}
          >
            {uploadBusy ? 'uploading…' : '📎 attach a file (image or PDF, max 10MB)'}
          </label>
        </div>
      </VtPanel>
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 700, color: vtInk, margin: '4px 0 4px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim };
