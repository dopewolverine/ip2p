'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtSmallButton, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import { useWalletSession } from '@/lib/walletSession';
import {
  getResolutionView, recommendOutcome, decideOutcome, getArbitrationProposal, submitArbitrationResolution,
  ResolutionView,
} from '@/lib/api/adminDisputes';
import { ApiError } from '@/lib/api/client';

export default function ResolutionViewPage() {
  const { id } = useParams<{ id: string }>();
  const walletSession = useWalletSession();
  const [view, setView] = useState<ResolutionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [recOutcome, setRecOutcome] = useState<'buyer' | 'funder'>('buyer');
  const [recReason, setRecReason] = useState('');

  const [decideReason, setDecideReason] = useState('');
  const [decided, setDecided] = useState<string | null>(null);

  const [proposal, setProposal] = useState<{ psbtBase64?: string; outputs: Array<{address: string | null; value: string}>; network_fee: string } | null>(null);
  const [signedPsbt, setSignedPsbt] = useState('');
  const [resolveResult, setResolveResult] = useState<string | null>(null);

  const load = () => {
    getResolutionView(id).then(setView).catch((e) => {
      if (e?.status === 403) setForbidden(true);
      else setError('could not load this dispute.');
    });
  };

  useEffect(() => { load(); }, [id]);

  const submitRecommend = async () => {
    setError(null);
    try {
      await recommendOutcome(id, recOutcome, recReason);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.body?.message ?? 'could not record recommendation.') : 'could not reach the server.');
    }
  };

  const submitDecide = async () => {
    setError(null);
    try {
      const res = await decideOutcome(id, recOutcome, decideReason);
      setDecided(res.resolution);
    } catch (e) {
      setError(e instanceof ApiError ? (e.body?.message ?? 'could not decide.') : 'only the owner can decide.');
    }
  };

  const fetchProposal = async () => {
    setError(null);
    try {
      const res = await getArbitrationProposal(id);
      setProposal(res);
    } catch (e) {
      setError(e instanceof ApiError ? (e.body?.message ?? 'could not build the arbitration proposal.') : 'could not reach the server.');
    }
  };

  const submitResolve = async () => {
    setError(null);
    try {
      const res = await submitArbitrationResolution(id, signedPsbt);
      setResolveResult(res.status === 'broadcast' ? `broadcast — txid ${res.txid}` : 'signature recorded, waiting on the other party.');
    } catch (e) {
      setError(e instanceof ApiError ? (e.body?.message ?? 'could not submit.') : 'could not reach the server.');
    }
  };

  if (forbidden) return <AppShell section="Admin"><VtPanel><p style={subStyle}>staff or owner access only.</p></VtPanel></AppShell>;
  if (!view) return <AppShell section="Admin"><VtPanel><p style={subStyle}>loading…</p></VtPanel></AppShell>;

  const c = view.contract;

  return (
    <AppShell
      section="Admin" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <Section title="contract">
        <Field label="reference">{c.reference}</Field>
        <Field label="state">{c.state}</Field>
        <Field label="asset / chain">{c.asset} / {c.chain}</Field>
        <Field label="amount">{c.amount} (fee {c.fee_amount})</Field>
        <Field label="fiat">{c.fiat_amount} {c.fiat_currency_code} at {c.price_snapshot}</Field>
        <Field label="payment method">{c.payment_method ?? '—'} (reversal window: {c.reversal_window_days ?? '—'}d, tier {c.risk_tier ?? '—'})</Field>
        <Field label="timestamps">
          created {fmt(c.created_at)} · accepted {fmt(c.accepted_at)} · funded {fmt(c.funded_at)} · paid {fmt(c.paid_at)}
        </Field>
        <Field label="escrow address">{c.escrow_address ?? '—'}</Field>
        <Field label="funding tx">{c.funding_txid ?? '—'} ({c.funding_confirmations ?? '?'} confirmations)</Field>
      </Section>

      <Section title="destination for arbitration — compare against the ledger screen" accent>
        <Field label="buyer (would receive on release)">{view.destination_for_arbitration.buyer_address ?? 'Address not registered'}</Field>
        <Field label="funder (would receive on refund)">{view.destination_for_arbitration.funder_address ?? 'Address not registered'}</Field>
        <Field label="amount">{view.destination_for_arbitration.amount} {view.destination_for_arbitration.asset}</Field>
      </Section>

      <Section title="both parties">
        <Field label="vendor">{view.parties.vendor.username} · {view.parties.vendor.completed_trades} completed trades · joined {fmt(view.parties.vendor.account_created_at)}</Field>
        <Field label="customer">{view.parties.customer.username} · {view.parties.customer.completed_trades} completed trades · joined {fmt(view.parties.customer.account_created_at)}</Field>
      </Section>

      <Section title="dispute">
        <Field label="reason">{view.dispute?.reason_code} — {view.dispute?.reason_text}</Field>
        {view.dispute?.staff_recommendation && (
          <Field label="staff recommendation">{view.dispute.staff_recommendation} — {view.dispute.recommendation_reason}</Field>
        )}
      </Section>

      <Section title="chat">
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {view.chat.map((m) => (
            <div key={m.id} style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: vtMono, fontSize: 10, color: vtInkDim, textTransform: 'uppercase' }}>
                {m.sender_type} · {fmt(m.created_at)}
              </div>
              <div style={{ fontFamily: vtMono, fontSize: 12, color: vtInk }}>{m.body ?? '[attachment]'}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="payment instruction history">
        {view.payment_instructions?.map((item) => <Field key={item.id} label={fmt(item.created_at)}>{item.details}</Field>)}
      </Section>
      <Section title="evidence">
        {view.evidence.length === 0 ? <p style={subStyle}>none uploaded.</p> : view.evidence.map((e) => (
          <div key={e.id} style={{ fontFamily: vtMono, fontSize: 11.5, color: vtInk, marginBottom: 4 }}>
            <a href={`/api/attachments/${e.id}`} target="_blank" rel="noreferrer" style={{ color: vtGold }}>
              {e.original_filename}
            </a> ({e.mime_type})
          </div>
        ))}
      </Section>

      <Section title="recommend an outcome (staff)">
        <select value={recOutcome} onChange={(e) => setRecOutcome(e.target.value as any)} style={selectStyle}>
          <option value="buyer">release to buyer</option>
          <option value="funder">refund to funder</option>
        </select>
        <div style={{ marginTop: 10 }}>
          <VtTextField label="reason" value={recReason} onChange={(e) => setRecReason(e.target.value)} />
        </div>
        <VtSmallButton onClick={submitRecommend} disabled={!recReason.trim()}>record recommendation</VtSmallButton>
      </Section>

      <Section title="decide (owner only)" accent>
        <p style={{ ...subStyle, fontSize: 11 }}>uses the outcome selected above. requires a non-empty reason — no silent resolutions.</p>
        <VtTextField label="decision reason" value={decideReason} onChange={(e) => setDecideReason(e.target.value)} />
        <VtSmallButton onClick={submitDecide} disabled={!decideReason.trim()}>decide</VtSmallButton>
        {decided && <div style={{ fontFamily: vtMono, fontSize: 12, color: vtSage, marginTop: 8 }}>decided: {decided}</div>}
      </Section>

      <Section title="execute with hardware (owner only)" accent>
        <p style={{ ...subStyle, fontSize: 11 }}>
          sign this PSBT on the owner ledger, check every output against the device screen, then paste the signed PSBT below.
        </p>
        <VtSmallButton onClick={fetchProposal}>build arbitration proposal</VtSmallButton>
        {proposal?.outputs.map((o, i) => <Field key={i} label={`Output ${i + 1}`}>
          {o.address ?? 'Unrecognized address'}: {Number(o.value) / 100000000} {c.asset} ({o.value} base units)
        </Field>)}
        {proposal && <Field label="Network fee">{Number(proposal.network_fee) / 100000000} {c.asset}</Field>}
        {proposal?.psbtBase64 && (
          <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, wordBreak: 'break-all', margin: '10px 0' }}>
            {proposal.psbtBase64}
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <VtTextField label="signed transaction from ledger" value={signedPsbt} onChange={(e) => setSignedPsbt(e.target.value)} />
        </div>
        <VtSmallButton onClick={submitResolve} disabled={!signedPsbt.trim()}>submit and broadcast</VtSmallButton>
        {resolveResult && <div style={{ fontFamily: vtMono, fontSize: 12, color: vtSage, marginTop: 8 }}>{resolveResult}</div>}
      </Section>

      {error && <VtErrorText>{error}</VtErrorText>}
    </AppShell>
  );
}

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ fontFamily: vtMono, fontSize: 11, color: vtInkDim }}>{label}: </span>
      <span style={{ fontFamily: vtMono, fontSize: 12, color: vtInk }}>{children}</span>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      background: vtSurfaceDeep, border: `1px solid ${accent ? vtGold : vtLine}`, borderRadius: 6,
      padding: '18px 20px', width: '100%', marginBottom: 14,
    }}>
      <div style={{ fontFamily: vtMono, fontSize: 11, letterSpacing: '0.06em', color: vtGold, textTransform: 'uppercase', marginBottom: 10 }}>
        $ {title}
      </div>
      {children}
    </div>
  );
}

const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, lineHeight: 1.5 };
const selectStyle: React.CSSProperties = {
  width: '100%', padding: '9px 10px', fontFamily: vtMono, fontSize: 12.5, color: vtInk,
  background: '#0D0E0C', border: `1px solid ${vtLine}`, borderRadius: 5, boxSizing: 'border-box',
};
