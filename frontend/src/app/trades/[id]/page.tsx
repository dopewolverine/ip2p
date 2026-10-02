'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtSmallButton, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { getContract, getContractKeys, setPaymentDetails, ContractRow, ContractKeys } from '@/lib/api/escrow';
import { getMessages, sendMessage, openDispute, markPaid, uploadAttachment, attachmentUrl, ChatMessage } from '@/lib/api/chat';
import { getReputation, VendorReputation } from '@/lib/api/marketplace';
import { ReputationBadge } from '@/components/ReputationBadge';
import { EscrowPanel } from '@/components/EscrowPanel';
import { ApiError } from '@/lib/api/client';
import { useWalletSession } from '@/lib/walletSession';

const POLL_MS = 5000;
const CONTRACT_POLL_MS = 15000;
const MULTISIG_CHAINS = new Set(['bitcoin', 'litecoin']);

const DISPUTE_REASONS = [
  { code: 'no_payment_received', label: "I haven't received payment" },
  { code: 'payment_not_recognized', label: "My payment isn't being recognized" },
  { code: 'wrong_amount', label: 'Wrong amount was sent' },
  { code: 'counterparty_unresponsive', label: 'Counterparty is unresponsive' },
  { code: 'other', label: 'Other' },
];

export default function TradeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? '');
  const walletSession = useWalletSession();

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [contract, setContract] = useState<ContractRow | null>(null);
  const [contractKeys, setContractKeys] = useState<ContractKeys | null>(null);
  const [vendorReputation, setVendorReputation] = useState<VendorReputation | undefined>(undefined);
  const [customerReputation, setCustomerReputation] = useState<VendorReputation | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState(DISPUTE_REASONS[0]!.code);
  const [disputeText, setDisputeText] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState('');
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMessages = async () => {
    try {
      const res = await getMessages(id);
      setMessages(res.messages);
    } catch {
      // polling - a single failed tick isn't worth surfacing
    }
  };

  const loadContract = async () => {
    try {
      const c = await getContract(id);
      setContract(c);
      setDetailsDraft((d) => d || c.payment_details || '');
      getReputation(c.vendor_id).then(setVendorReputation).catch(() => {});
      getReputation(c.customer_id).then(setCustomerReputation).catch(() => {});
      if (MULTISIG_CHAINS.has(c.chain)) getContractKeys(id).then(setContractKeys).catch(() => {});
    } catch {
      // handled by the signed-in check
    }
  };

  useEffect(() => {
    me().then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    loadContract();
    loadMessages();
    const m = setInterval(loadMessages, POLL_MS);
    const c = setInterval(loadContract, CONTRACT_POLL_MS);
    return () => { clearInterval(m); clearInterval(c); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      await sendMessage(id, draft);
      setDraft('');
      await loadMessages();
    } catch (e) {
      setError(e instanceof ApiError ? 'could not send that message.' : 'could not reach the server.');
    }
  };

  const handleUpload = async (file: File) => {
    setError(null);
    setUploadBusy(true);
    try {
      await uploadAttachment(id, file);
      await loadMessages();
    } catch {
      setError('could not upload that file — only images and PDF, up to 10MB.');
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleMarkPaid = async () => {
    setError(null);
    try {
      const res = await markPaid(id);
      setContract((c) => (c ? { ...c, state: res.state } : c));
    } catch {
      setError('could not mark as paid.');
    }
  };

  const handleDispute = async () => {
    setError(null);
    try {
      const res = await openDispute(id, disputeReason, disputeText);
      setContract((c) => (c ? { ...c, state: res.state } : c));
      setShowDispute(false);
      await loadMessages();
    } catch (e) {
      setError(e instanceof ApiError ? 'could not open a dispute.' : 'could not reach the server.');
    }
  };

  const saveDetails = async () => {
    setError(null);
    setDetailsBusy(true);
    try {
      await setPaymentDetails(id, detailsDraft.trim());
      setDetailsSaved(true);
      await loadContract();
    } catch {
      setError('could not save your payment details.');
    } finally {
      setDetailsBusy(false);
    }
  };

  if (signedIn === false) {
    return (
      <AppShell section="Trade"><VtPanel>
        <VtEyebrow>trade</VtEyebrow>
        <h1 style={titleStyle}>sign in first</h1>
        <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
      </VtPanel></AppShell>
    );
  }

  const iAmSeller = !!contract && contract.my_party === contract.crypto_side;

  return (
    <AppShell
      section="Trade" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <VtPanel>
        <VtEyebrow>trade</VtEyebrow>
        <h1 style={titleStyle}>{contract ? contract.reference : 'loading…'}</h1>
        {contract && (
          <div style={{ fontFamily: vtMono, fontSize: 12, color: vtInkDim, marginBottom: 12 }}>
            {contract.asset.replace('_', ' ')} · {contract.fiat_amount} · you are the {iAmSeller ? 'seller' : 'buyer'} ·
            state: <span style={{ color: vtGold }}>{contract.state}</span>
          </div>
        )}

        {contract && (
          <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={labelStyle}>vendor</div>
              <ReputationBadge reputation={vendorReputation} />
            </div>
            <div>
              <div style={labelStyle}>customer</div>
              <ReputationBadge reputation={customerReputation} />
            </div>
          </div>
        )}

        {error && <VtErrorText>{error}</VtErrorText>}

        {contract && (
          <EscrowPanel contract={contract} keys={contractKeys} mnemonic={walletSession.mnemonic} onChanged={loadContract} />
        )}

        {contract && iAmSeller && ['requested', 'accepted', 'funded'].includes(contract.state) && (
          <div style={boxStyle}>
            <div style={labelStyle}>your payment details — how the buyer pays you</div>
            <textarea
              value={detailsDraft}
              onChange={(e) => { setDetailsDraft(e.target.value); setDetailsSaved(false); }}
              rows={3}
              maxLength={1000}
              placeholder="e.g. bank, IBAN and account holder — or your PayPal / Revolut handle"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
              <VtSmallButton onClick={saveDetails} disabled={!detailsDraft.trim() || detailsBusy}>
                {detailsBusy ? 'saving…' : detailsSaved ? 'saved ✓' : 'save'}
              </VtSmallButton>
              <span style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim }}>
                the buyer sees these once the escrow is funded. unlike chat, they are not filtered.
              </span>
            </div>
          </div>
        )}

        {contract && contract.payment_instructions?.length > 0 && <details style={{marginBottom: 16}}>
          <summary>Payment instruction history</summary>
          {contract.payment_instructions.map((item) => <p key={item.id} style={{whiteSpace:'pre-wrap'}}>
            {new Date(item.created_at).toLocaleString()}<br />{item.details}
          </p>)}
        </details>}
        {contract && !iAmSeller && contract.payment_details && (
          <div style={boxStyle}>
            <div style={labelStyle}>payment details from the seller</div>
            <div style={{ fontFamily: vtMono, fontSize: 12.5, color: vtInk, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {contract.payment_details}
            </div>
          </div>
        )}

        {contract && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {contract.state === 'funded' && !iAmSeller && (
              <VtSmallButton onClick={handleMarkPaid}>mark payment sent</VtSmallButton>
            )}
            {(contract.state === 'funded' || contract.state === 'paid') && (
              <VtSmallButton onClick={() => setShowDispute((v) => !v)} muted>
                {showDispute ? 'cancel' : 'open a dispute'}
              </VtSmallButton>
            )}
          </div>
        )}

        {showDispute && (
          <div style={boxStyle}>
            <select value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} style={selectStyle}>
              {DISPUTE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <div style={{ marginTop: 10 }}>
              <VtTextField label="explain what happened" value={disputeText} onChange={(e) => setDisputeText(e.target.value)} />
            </div>
            <VtSmallButton onClick={handleDispute} disabled={!disputeText.trim()}>submit dispute</VtSmallButton>
          </div>
        )}

        <div style={{
          border: `1px solid ${vtLine}`, borderRadius: 5, background: vtSurfaceDeep,
          height: 340, overflowY: 'auto', padding: 14, marginBottom: 12,
        }}>
          {messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 10 }}>
              <div style={{
                fontFamily: vtMono, fontSize: 10, color: m.sender_type === 'system' ? vtGold : vtInkDim,
                textTransform: 'uppercase', marginBottom: 2,
              }}>
                {m.sender_type} · {new Date(m.created_at).toLocaleTimeString()}
              </div>
              <div style={{
                fontFamily: vtMono, fontSize: 12.5, color: vtInk,
                fontStyle: m.sender_type === 'system' ? 'italic' : 'normal',
                opacity: m.sender_type === 'system' ? 0.75 : 1,
              }}>
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
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="message…"
            style={{ ...inputStyle, flex: 1 }}
          />
          <VtSmallButton onClick={handleSend}>send</VtSmallButton>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            style={{ display: 'none' }}
            id="attach-input"
          />
          <label
            htmlFor="attach-input"
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
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700, color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
const labelStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 9.5, color: vtInkDim, textTransform: 'uppercase', marginBottom: 3 };
const boxStyle: React.CSSProperties = { padding: 14, background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 5, marginBottom: 16 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontFamily: vtMono, fontSize: 12.5, color: vtInk,
  background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 5, boxSizing: 'border-box',
};
const selectStyle: React.CSSProperties = {
  width: '100%', padding: '9px 10px', fontFamily: vtMono, fontSize: 12.5, color: vtInk,
  background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 5, boxSizing: 'border-box',
};
