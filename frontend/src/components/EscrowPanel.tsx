'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { VtSmallButton, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { ApiError } from '@/lib/api/client';
import {
  ContractRow, ContractKeys, Proposal, submitContractKey, checkFunding, createProposal, getProposal,
  submitProposalSignature, reportSecurityAlert,
} from '@/lib/api/escrow';
import { deriveTradeKeys, verifyEscrowSetup, verifyProposal, signProposal, VerificationError, VerifiedOutput } from '@/lib/escrow/verify';
import { pinnedFor } from '@/lib/escrow/config';
import { IS_TESTNET, UtxoChain } from '@/lib/network';
import { ASSET_DECIMALS, fromBaseUnits } from '@/lib/crypto/units';

type Purpose = 'release' | 'refund';
type Party = 'vendor' | 'customer';

function explorerAddressUrl(chain: UtxoChain, address: string) {
  const net = IS_TESTNET ? 'testnet/' : '';
  return chain === 'bitcoin' ? `https://blockstream.info/${net}address/${address}` : `https://litecoinspace.org/${net}address/${address}`;
}

const ERRORS: Record<string, string> = {
  purpose_not_allowed_in_state: 'that is not possible in the current state of the trade.',
  payout_address_missing: 'a payout address is missing.',
  no_confirmed_funds: 'no confirmed funds at the escrow address yet.',
  funding_output_missing: 'the funding payment is no longer visible — try again shortly.',
  already_finalized: 'this was already signed and sent.',
  already_signed: 'you already signed this.',
  not_a_signer_for_this_purpose: 'your signature is not needed for this.',
  psbt_mismatch: 'the transaction changed while you were signing — start again.',
  insufficient_network_fee: 'there is not enough in escrow to pay the network fee.',
  no_active_platform_key: 'escrow is not configured on the server yet.',
  invalid_payout_address: 'your payout address was rejected.',
  unexpected_derivation_path: 'your escrow key path was rejected.',
  wrong_state: 'the trade is not in the right state for that.',
  rate_limited: 'too many attempts — wait a bit.',
};
const humanize = (e: ApiError) => ERRORS[e.body?.error] ?? 'something went wrong. try again.';

export function EscrowPanel({
  contract, keys, mnemonic, onChanged,
}: { contract: ContractRow; keys: ContractKeys | null; mnemonic: string | null; onChanged: () => Promise<void> | void }) {
  const chain = contract.chain as UtxoChain;
  const idx = Number(contract.contract_index);
  const myParty = contract.my_party;
  const funder: Party = contract.crypto_side;
  const buyer: Party = funder === 'vendor' ? 'customer' : 'vendor';
  const decimals = ASSET_DECIMALS[contract.asset] ?? 8;
  const unit = contract.asset.replace(/_.*/, '');
  const fmt = (v: bigint | string) => `${fromBaseUnits(String(v), decimals)} ${unit}`;

  // Derived once per page, not on every render (PBKDF2 over the phrase).
  const mine = useMemo(() => (mnemonic ? deriveTradeKeys(mnemonic, chain, idx) : null), [mnemonic, chain, idx]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [checked, setChecked] = useState<{ outputs: VerifiedOutput[]; networkFee: bigint } | null>(null);
  const [done, setDone] = useState<{ status: string; txid?: string } | null>(null);
  const [pending, setPending] = useState<Proposal | null>(null);

  // Rule 5 / §4A.1: the escrow address is shown to fund only after the
  // browser has rebuilt it from the three keys (platform key from the
  // pinned xpub) and checked both payout addresses.
  const setup = useMemo(() => {
    if (!mine || !keys || !contract.escrow_address) return null;
    try {
      verifyEscrowSetup({ chain, contractIndex: idx, myParty, mine, keys, escrowAddress: contract.escrow_address, witnessScriptHex: contract.redeem_script });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, check: e instanceof VerificationError ? e.check : 'unknown', message: e instanceof Error ? e.message : 'verification failed.' };
    }
  }, [mine, keys, contract.escrow_address, contract.redeem_script, chain, idx, myParty]);

  const setupFailure = setup && !setup.ok ? setup.check : null;
  useEffect(() => {
    if (setupFailure && setupFailure !== 'escrow_not_configured') reportSecurityAlert(contract.id, setupFailure).catch(() => {});
  }, [setupFailure, contract.id]);

  const available: Purpose[] = useMemo(() => {
    if (contract.settlement) return [];
    const s = contract.state;
    if (s === 'paid') return ['release', 'refund'];
    if (s === 'funded') return ['refund'];
    if (s === 'disputed' && contract.resolution === 'released_to_buyer' && myParty === buyer) return ['release'];
    if (s === 'disputed' && contract.resolution === 'refunded_to_funder' && myParty === funder) return ['refund'];
    if (s === 'cancelled' && contract.stranded_detected_at) return ['refund'];
    return [];
  }, [contract.state, contract.resolution, contract.stranded_detected_at, contract.settlement, myParty, buyer, funder]);
  const availableKey = available.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of available) {
        try {
          const prop = await getProposal(contract.id, p);
          if (!cancelled && prop.status === 'partially_signed' && prop.first_signer !== myParty) {
            setPending(prop);
            return;
          }
        } catch {
          // no proposal for this purpose
        }
      }
      if (!cancelled) setPending(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id, contract.state, availableKey, myParty]);

  if (chain !== 'bitcoin' && chain !== 'litecoin') return null;

  const haveSubmitted = !!(mine && keys && keys[myParty]?.toLowerCase() === mine.publicKeyHex);

  const submitKey = async () => {
    if (!mine) return;
    setErr(null);
    setBusy(true);
    try {
      await submitContractKey(contract.id, mine.publicKeyHex, mine.path, mine.payoutAddress);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? humanize(e) : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    setErr(null);
    setBusy(true);
    try {
      await checkFunding(contract.id);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? humanize(e) : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const start = async (p: Purpose) => {
    if (!mine || !keys || !contract.escrow_address) return;
    setErr(null);
    setBusy(true);
    setPurpose(p);
    setChecked(null);
    setDone(null);
    try {
      const prop = await createProposal(contract.id, p);
      if (!prop.psbt) throw new Error('no_psbt');
      const result = verifyProposal({
        chain, contractIndex: idx, myParty, mine, keys, escrowAddress: contract.escrow_address,
        witnessScriptHex: contract.redeem_script, purpose: p, psbtBase64: prop.psbt,
        contract: {
          state: contract.state, crypto_side: contract.crypto_side, amount: contract.amount,
          fee_amount: contract.fee_amount, network_reserve: contract.network_reserve,
        },
      });
      setProposal(prop);
      setChecked(result);
    } catch (e) {
      setPurpose(null);
      if (e instanceof VerificationError) {
        setErr(`not signed — ${e.message} this has been reported to the platform.`);
        reportSecurityAlert(contract.id, e.check).catch(() => {});
      } else {
        setErr(e instanceof ApiError ? humanize(e) : 'could not prepare the transaction.');
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!mine || !proposal?.psbt || !purpose) return;
    setErr(null);
    setBusy(true);
    try {
      const signed = signProposal(proposal.psbt, chain, mine);
      const res = await submitProposalSignature(contract.id, purpose, signed);
      setDone(res);
      setChecked(null);
      setProposal(null);
      setPending(null);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? humanize(e) : 'signing failed.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setPurpose(null);
    setChecked(null);
    setProposal(null);
    setErr(null);
  };

  const roleLabel: Record<VerifiedOutput['role'], string> = {
    buyer: 'to the buyer', fee: 'platform fee', change: 'unused reserve back to the seller', refund: 'refund to the seller',
  };

  return (
    <div style={{ padding: 14, background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 5, marginBottom: 16 }}>
      <div style={{ fontFamily: vtMono, fontSize: 12.5, color: vtGold, marginBottom: 8 }}>
        $ escrow — {chain}{IS_TESTNET ? ' testnet' : ''}
      </div>

      {contract.settlement && <p style={dim}>
        {contract.settlement.status === 'confirmed' ? 'Settlement confirmed.' : contract.settlement.status === 'broadcast'
          ? 'Transaction submitted. Waiting for blockchain confirmations.' : 'Transaction signed. Waiting for successful submission.'}
        <br />Transaction: {contract.settlement.txid}
        {contract.settlement.last_error && <><br />Submission could not be verified. Your trade remains open while the server retries.</>}
      </p>}
      {setup?.ok && keys && <VtSmallButton onClick={() => {
        const bundle = {
          format: 'ip2p-escrow-recovery-v1', network: IS_TESTNET ? 'testnet' : 'mainnet',
          chain, state: contract.state, platform_xpub: pinnedFor(chain)!.platformXpub, fee_address: pinnedFor(chain)!.feeAddress, reference: contract.reference, contract_id: contract.id, contract_index: idx,
          escrow_address: contract.escrow_address, witness_script: contract.redeem_script,
          keys, amount: contract.amount, fee_amount: contract.fee_amount,
          crypto_side: contract.crypto_side, network_reserve: contract.network_reserve,
          exported_at: new Date().toISOString(),
          instructions: 'Public recovery data only. Keep your recovery phrase separately. Two escrow key signatures are required. Use tools/recover-escrow.cjs with this bundle and independently obtained UTXOs. Never send your phrase to support.',
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], {type: 'application/json'}));
        const a = document.createElement('a'); a.href = url; a.download = `ip2p-${contract.reference}-recovery.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>download escrow recovery package</VtSmallButton>}
      {!mnemonic && (
        <p style={dim}>log in again in this tab — your escrow key and every check below run in this browser from your recovery phrase.</p>
      )}

      {mine && contract.state === 'accepted' && !contract.escrow_address && (
        haveSubmitted ? (
          <p style={dim}>your key is in. waiting for the other party.</p>
        ) : (
          <div>
            <p style={dim}>
              submit your escrow key for this trade. your payout address (where coins come to you if this trade pays you) is your {unit} wallet:
            </p>
            <div style={addr}>{mine.payoutAddress}</div>
            <VtSmallButton onClick={submitKey} disabled={busy}>{busy ? 'working…' : 'submit my key'}</VtSmallButton>
          </div>
        )
      )}

      {contract.escrow_address && setup && !setup.ok && (
        <VtErrorText>
          do not send funds to this trade. {setup.message}
          {setup.check !== 'escrow_not_configured' ? ' this has been reported to the platform.' : ''}
        </VtErrorText>
      )}

      {contract.escrow_address && setup?.ok && contract.state === 'accepted' && (
        <div>
          <div style={label}>escrow address — verified in your browser</div>
          <div style={addr}>{contract.escrow_address}</div>
          {myParty === funder && contract.required_funding && (
            <div style={{ ...dim, color: vtInk }}>
              send one payment of at least <span style={{ color: vtGold }}>{fmt(contract.required_funding)}</span>
              <div style={dim}>
                trade amount {fmt(contract.amount)} · platform fee {fmt(contract.fee_amount)} · network-fee reserve {fmt(contract.network_reserve)}.
                the reserve pays the miner when the escrow pays out; whatever isn&apos;t used comes back to you.
              </div>
            </div>
          )}
          <div style={dim}>{contract.funding_txid ? 'payment seen — waiting for confirmations.' : 'not funded yet.'}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href={explorerAddressUrl(chain, contract.escrow_address)} target="_blank" rel="noreferrer" style={{ fontFamily: vtMono, fontSize: 11, color: vtGold }}>
              view on explorer
            </a>
            {myParty === funder && <VtSmallButton onClick={recheck} disabled={busy}>i&apos;ve sent it — check now</VtSmallButton>}
          </div>
        </div>
      )}

      {contract.state === 'funded' && setup?.ok && <p style={dim}>escrow funded.</p>}

      {pending && !checked && !done && setup?.ok && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ ...dim, color: vtInk }}>the other party signed a {pending.purpose}. review it and co-sign.</p>
          <VtSmallButton onClick={() => start(pending.purpose)} disabled={busy}>review and co-sign</VtSmallButton>
        </div>
      )}

      {available.length > 0 && setup?.ok && !checked && !done && !pending && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {available.includes('release') && (contract.state !== 'paid' || myParty === funder) && (
            <VtSmallButton onClick={() => start('release')} disabled={busy || !mine}>
              {contract.state === 'disputed' ? 'sign the release (dispute decided for you)' : 'release to buyer'}
            </VtSmallButton>
          )}
          {available.includes('refund') && (
            <VtSmallButton onClick={() => start('refund')} muted disabled={busy || !mine}>
              {contract.state === 'disputed' ? 'sign the refund (dispute decided for you)'
                : contract.state === 'cancelled' ? 'return the stranded coins to the seller' : 'mutual refund'}
            </VtSmallButton>
          )}
        </div>
      )}
      {contract.state === 'paid' && myParty === buyer && !pending && !done && (
        <p style={dim}>the seller releases after confirming your payment. you&apos;ll be asked to co-sign here.</p>
      )}

      {checked && purpose && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...dim, color: vtSage }}>checked in your browser. this transaction pays:</div>
          {checked.outputs.map((o) => (
            <div key={`${o.role}-${o.address}`} style={{ fontFamily: vtMono, fontSize: 11.5, color: vtInk, marginBottom: 4 }}>
              {roleLabel[o.role]}: <span style={{ color: vtGold }}>{fmt(o.value)}</span>
              <div style={{ fontSize: 10.5, color: vtInkDim, wordBreak: 'break-all' }}>{o.address}</div>
            </div>
          ))}
          <div style={{ ...dim, marginTop: 6 }}>network fee: {fmt(checked.networkFee)}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <VtSmallButton onClick={confirm} disabled={busy}>{busy ? 'signing…' : 'confirm and sign'}</VtSmallButton>
            <VtSmallButton onClick={cancel} muted>cancel</VtSmallButton>
          </div>
        </div>
      )}

      {done && (
        <div style={{ fontFamily: vtMono, fontSize: 12, color: vtSage, marginTop: 8 }}>
          {done.status === 'awaiting_counterparty' ? 'signed — waiting for the other signature.'
            : done.status === 'broadcast' ? 'broadcast — pending confirmation.' : 'signed — it will be broadcast shortly.'}
          {done.txid && <div style={{ fontSize: 10.5, color: vtInkDim, wordBreak: 'break-all' }}>txid: {done.txid}</div>}
        </div>
      )}

      {err && <VtErrorText>{err}</VtErrorText>}
    </div>
  );
}

const dim: React.CSSProperties = { fontFamily: vtMono, fontSize: 11.5, color: vtInkDim, lineHeight: 1.6, margin: '0 0 8px' };
const label: React.CSSProperties = { fontFamily: vtMono, fontSize: 9.5, color: vtInkDim, textTransform: 'uppercase', marginBottom: 4 };
const addr: React.CSSProperties = {
  fontFamily: vtMono, fontSize: 11, color: vtInk, wordBreak: 'break-all', background: '#0D0E0C',
  border: `1px solid ${vtLine}`, borderRadius: 4, padding: '6px 8px', marginBottom: 8,
};
