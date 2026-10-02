'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtSmallButton, VtSmallLink, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtSteel, vtErr, vtLine, vtSurface, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { me, logout } from '@/lib/api/auth';
import {
  getWalletAddresses, getWalletBalance, getWalletBalanceById, getWalletValue, buildTransaction, broadcastTransaction, requestExport,
  WalletEntry, BalanceResponse, FiatValue,
} from '@/lib/api/wallet';
import { ASSET_DECIMALS, toBaseUnits, fromBaseUnits } from '@/lib/crypto/units';
import { signTransaction, WalletAsset } from '@/lib/crypto/signTransaction';
import { exportPrivateKey } from '@/lib/crypto/exportKey';
import { useWalletSession } from '@/lib/walletSession';
import { ApiError } from '@/lib/api/client';
import { deriveAllWalletAddresses } from '@/lib/crypto/walletDerivation';
import { verifyWithdrawal, WithdrawalCheckError } from '@/lib/crypto/verifyWithdrawal';
import { ArchivedUnlock } from '@/components/ArchivedUnlock';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

const GROUPS: { network: string; assets: { asset: string; label: string }[] }[] = [
  { network: 'bitcoin', assets: [{ asset: 'BTC', label: 'BTC' }] },
  { network: 'litecoin', assets: [{ asset: 'LTC', label: 'LTC' }] },
  {
    network: 'ethereum',
    assets: [
      { asset: 'ETH', label: 'ETH' },
      { asset: 'USDT_ERC20', label: 'USDT (ERC20)' },
      { asset: 'USDC_ERC20', label: 'USDC (ERC20)' },
    ],
  },
  { network: 'tron', assets: [{ asset: 'USDT_TRC20', label: 'USDT (TRC20)' }] },
];
const ASSET_LIST = GROUPS.flatMap((g) => g.assets.map((a) => a.asset));

const GLYPHS: Record<string, { symbol: string; color: string }> = {
  BTC: { symbol: '₿', color: vtGold },
  LTC: { symbol: 'Ł', color: vtSteel },
  ETH: { symbol: 'Ξ', color: vtSteel },
  USDT_ERC20: { symbol: '₮', color: vtSage },
  USDC_ERC20: { symbol: 'Ⓒ', color: vtSage },
  USDT_TRC20: { symbol: '₮', color: vtSage },
};

const HAS_FEE_FIELD = new Set(['BTC', 'LTC', 'ETH']);

type ViewState = 'loading' | 'signed-out' | 'ready';
type SendPhase = 'building' | 'awaiting_confirm' | 'signing' | 'broadcasting' | 'done';
type ActionPanel = 'receive' | 'send' | 'export';

export default function WalletsPage() {
  const [view, setView] = useState<ViewState>('loading');
  const [wallets, setWallets] = useState<Record<string, WalletEntry>>({});
  const [archivedWallets, setArchivedWallets] = useState<WalletEntry[]>([]);
  const [archivedBalances, setArchivedBalances] = useState<Record<string, BalanceResponse>>({});
  const [loadingArchived, setLoadingArchived] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [balances, setBalances] = useState<Record<string, BalanceResponse>>({});
  const [values, setValues] = useState<Record<string, FiatValue>>({});
  const [totalCurrency, setTotalCurrency] = useState('USD');
  const [balancesLoading, setBalancesLoading] = useState(false);

  const [openAsset, setOpenAsset] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<ActionPanel | null>(null);
  const [copiedAsset, setCopiedAsset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendFeeRate, setSendFeeRate] = useState('');
  const [sendPhase, setSendPhase] = useState<SendPhase | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendTxid, setSendTxid] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<{ format: any; data: any; amountBase: string } | null>(null);
  const [verifiedFee, setVerifiedFee] = useState<string | null>(null);

  const [exportKey, setExportKey] = useState<string | null>(null);
  const [exportAck, setExportAck] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const walletSession = useWalletSession();

  // A deposit address is shown only if it equals the
  // address this browser derives from the recovery phrase. A session thief
  // who swapped it on the server gets a warning here, not your deposit.
  const derivedAddresses = useMemo(() => {
    if (!walletSession.mnemonic) return null;
    try {
      return Object.fromEntries(deriveAllWalletAddresses(walletSession.mnemonic).map((d) => [d.asset, d.address])) as Record<string, string>;
    } catch {
      return null;
    }
  }, [walletSession.mnemonic]);

  useEffect(() => {
    me()
      .then(() => getWalletAddresses())
      .then((res) => {
        const byAsset: Record<string, WalletEntry> = {};
        const archived: WalletEntry[] = [];
        for (const w of res.wallets) {
          if (w.status === 'active') byAsset[w.asset] = w;
          else archived.push(w);
        }
        setArchivedWallets(archived);
        setWallets(byAsset);
        setView('ready');
        loadValues('USD');
      })
      .catch(() => setView('signed-out'));
  }, []);

  const loadBalances = async () => {
    setBalancesLoading(true);
    const results = await Promise.allSettled(ASSET_LIST.map((a) => getWalletBalance(a)));
    const map: Record<string, BalanceResponse> = {};
    ASSET_LIST.forEach((asset, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') map[asset] = r.value;
    });
    setBalances(map);
    setBalancesLoading(false);
  };

  const loadValues = async (currency: string) => {
    const results = await Promise.allSettled(ASSET_LIST.map((a) => getWalletValue(a, currency)));
    const map: Record<string, FiatValue> = {};
    ASSET_LIST.forEach((asset, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') map[asset] = r.value;
    });
    setValues(map);
  };

  const changeCurrency = (currency: string) => {
    setTotalCurrency(currency);
    loadValues(currency);
  };

  const fiatOf = (asset: string): number | null => {
    const bal = balances[asset];
    const val = values[asset];
    if (!bal || !val) return null;
    return Number(fromBaseUnits(bal.confirmed, ASSET_DECIMALS[asset])) * val.price_per_unit;
  };

  const totalValue = ASSET_LIST.reduce((sum, a) => sum + (fiatOf(a) ?? 0), 0);

  const copyAddress = (asset: string, address: string) => {
    navigator.clipboard?.writeText(address).then(() => {
      setCopiedAsset(asset);
      setTimeout(() => setCopiedAsset(null), 1500);
    });
  };

  const togglePanel = (asset: string, panel: ActionPanel) => {
    if (openAsset === asset && openPanel === panel) {
      setOpenAsset(null);
      setOpenPanel(null);
      return;
    }
    setOpenAsset(asset);
    setOpenPanel(panel);
    setError(null);
    if (panel === 'send') {
      setSendTo('');
      setSendAmount('');
      setSendFeeRate('');
      setSendPhase(null);
      setSendError(null);
      setSendTxid(null);
      setPendingTx(null);
    }
    if (panel === 'export') {
      setExportKey(null);
      setExportAck(false);
      setExportError(null);
    }
  };

  const showArchivedBalance = async (walletId: string, refresh = false) => {
    setError(null);
    setLoadingArchived(walletId);
    try {
      const res = await getWalletBalanceById(walletId, refresh);
      setArchivedBalances((b) => ({ ...b, [walletId]: res }));
    } catch (e) {
      setError(e instanceof ApiError ? humanizeError(e) : 'Could not reach the server.');
    } finally {
      setLoadingArchived(null);
    }
  };

  const startBuild = async (asset: string) => {
    setSendError(null);
    setSendPhase('building');
    try {
      const decimals = ASSET_DECIMALS[asset];
      const amountBase = toBaseUnits(sendAmount, decimals);
      const unsigned = await buildTransaction({
        asset,
        to: sendTo,
        amount: amountBase,
        fee_rate: HAS_FEE_FIELD.has(asset) && sendFeeRate ? toBaseUnitsFeeRate(sendFeeRate, asset) : undefined,
      });
      const withdrawalCheck = verifyWithdrawal({ asset, format: unsigned.format, data: unsigned.data, to: sendTo.trim(), amount: BigInt(amountBase), ownAddress: wallets[asset]?.address ?? '' });
      setVerifiedFee(withdrawalCheck.networkFee === null ? null : withdrawalCheck.networkFee.toString());
      setPendingTx({ format: unsigned.format, data: unsigned.data, amountBase });
      setSendPhase('awaiting_confirm');
    } catch (e) {
      setSendError(errorMessage(e));
      setSendPhase(null);
    }
  };

  const confirmAndSend = async (asset: string) => {
    if (!pendingTx || !walletSession.mnemonic) return;
    setSendError(null);
    try {
      setSendPhase('signing');
      const signed = await signTransaction(asset as WalletAsset, pendingTx.format, pendingTx.data, walletSession.mnemonic);

      setSendPhase('broadcasting');
      const res = await broadcastTransaction({
        asset,
        signed_tx: signed,
        to: sendTo,
        amount: pendingTx.amountBase,
      });

      setSendTxid(res.txid);
      setSendPhase('done');
      loadBalances();
    } catch (e) {
      setSendError(errorMessage(e));
      setSendPhase('awaiting_confirm');
    }
  };
  const revealExport = async (asset: string) => {
    if (!walletSession.mnemonic) return;
    setExportError(null);
    setExportBusy(true);
    try {
      await requestExport(asset);
      const key = exportPrivateKey(asset as any, walletSession.mnemonic);
      setExportKey(key);
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExportBusy(false);
    }
  };

  if (view === 'loading') return <AppShell section="Wallets"><VtPanel><p style={subStyle}>loading…</p></VtPanel></AppShell>;

  if (view === 'signed-out') {
    return (
      <AppShell section="Wallets">
        <VtPanel>
          <VtEyebrow>wallets</VtEyebrow>
          <h1 style={titleStyle}>sign in first</h1>
          <p style={subStyle}>you need to be logged in to see your wallets.</p>
          <a href="/login" style={{ textDecoration: 'none' }}><VtButton>go to login</VtButton></a>
        </VtPanel>
      </AppShell>
    );
  }

  return (
    <AppShell
      section="Wallets" wide accountNav
      onLogout={() => { logout().catch(() => {}); walletSession.clear(); window.location.href = '/login'; }}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <g id="wi-down"><path d="M10 4v10M6 10l4 4 4-4" /></g>
          <g id="wi-up"><path d="M10 16V6M6 10l4-4 4 4" /></g>
          <g id="wi-key"><circle cx="6.5" cy="10" r="3" /><path d="M9.3 10h7.7M14 10v3M17 10v2" /></g>
        </defs>
      </svg>

      <VtPanel>
        <VtEyebrow>wallets</VtEyebrow>
        {error && <VtErrorText>{error}</VtErrorText>}
        {!walletSession.mnemonic && (
          <p style={{ ...subStyle, fontSize: 11.5 }}>
            sending is unavailable until you log in again in this browser tab — the signing key only
            exists in memory for the current session and isn't saved anywhere.
          </p>
        )}

        <div style={{ textAlign: 'center', padding: '10px 0 20px', borderBottom: `1px solid ${vtLine}`, marginBottom: 14 }}>
          <div style={{ fontFamily: vtMono, fontSize: 9.5, color: vtInkDim, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
            total balance
          </div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 30, fontWeight: 700, color: vtInk }}>
            {balancesLoading ? '—' : `${totalValue.toFixed(2)} ${totalCurrency}`}
          </div>
          <div style={{ display: 'inline-flex', gap: 4, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {CURRENCIES.map((c) => (
              <span
                key={c}
                onClick={() => changeCurrency(c)}
                style={{
                  fontFamily: vtMono, fontSize: 9, padding: '2px 7px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${totalCurrency === c ? '#4A3E17' : vtLine}`,
                  color: totalCurrency === c ? vtGold : vtInkDim,
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {GROUPS.map((group) => (
          <div key={group.network} style={{ marginBottom: 18 }}>
            <div style={{
              fontFamily: vtMono, fontSize: 10, letterSpacing: '0.1em', color: vtGold,
              textTransform: 'uppercase', marginBottom: 6, opacity: 0.85,
            }}>
              {group.network}
            </div>
            <div style={{ borderTop: `1px solid ${vtLine}` }}>
              {group.assets.map(({ asset, label }) => {
                const wallet = wallets[asset];
                const bal = balances[asset];
                const fiat = fiatOf(asset);
                const glyph = GLYPHS[asset];
                const isOpen = openAsset === asset;
                return (
                  <div key={asset}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 2px', borderBottom: `1px solid ${vtLine}` }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${glyph.color}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        fontFamily: "'Fraunces', Georgia, serif", fontSize: 14, color: glyph.color,
                      }}>
                        {glyph.symbol}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: vtMono, fontSize: 12.5, color: vtInk }}>{label}</div>
                      </div>
                      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                        <div style={{ fontFamily: vtMono, fontSize: 12.5, color: vtInk }}>
                          {bal ? fromBaseUnits(bal.confirmed, ASSET_DECIMALS[asset]) : '—'}
                        </div>
                        <div style={{ fontFamily: vtMono, fontSize: 10, color: vtInkDim }}>
                          {fiat !== null ? `${fiat.toFixed(2)} ${totalCurrency}` : '—'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 5, marginLeft: 6, flexShrink: 0 }}>
                        <IconBtn active={isOpen && openPanel === 'receive'} onClick={() => togglePanel(asset, 'receive')} disabled={!wallet}>
                          <use href="#wi-down" />
                        </IconBtn>
                        <IconBtn active={isOpen && openPanel === 'send'} onClick={() => togglePanel(asset, 'send')} disabled={!wallet || !walletSession.mnemonic}>
                          <use href="#wi-up" />
                        </IconBtn>
                        <IconBtn active={isOpen && openPanel === 'export'} onClick={() => togglePanel(asset, 'export')} disabled={!wallet || !walletSession.mnemonic}>
                          <use href="#wi-key" />
                        </IconBtn>
                      </div>
                    </div>

                    {isOpen && openPanel === 'receive' && wallet && derivedAddresses?.[asset] !== wallet.address && (
                      <div style={{ padding: '12px 2px', borderBottom: `1px solid ${vtLine}` }}>
                        <VtErrorText>
                          {!derivedAddresses
                            ? 'log in again in this tab to see your deposit address — it is checked against your recovery phrase first.'
                            : 'this deposit address does not match your recovery phrase. do not send funds to it — contact support.'}
                        </VtErrorText>
                      </div>
                    )}
                    {isOpen && openPanel === 'receive' && wallet && derivedAddresses?.[asset] === wallet.address && (
                      <div style={{ padding: '12px 2px', borderBottom: `1px solid ${vtLine}` }}>
                        <div style={{ display: 'flex', gap: 14, background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 8, padding: 14 }}>
                          <div style={{ flexShrink: 0, textAlign: 'center' }}>
                            <div style={{ background: '#FFFFFF', borderRadius: 6, padding: 6, display: 'inline-block' }}>
                              <QRCodeSVG value={wallet.address} size={72} bgColor="#FFFFFF" fgColor="#0D0E0C" level="M" />
                            </div>
                            <button
                              onClick={() => copyAddress(asset, wallet.address)}
                              style={{
                                display: 'block', width: '100%', marginTop: 6, fontFamily: vtMono, fontSize: 9, padding: '4px 6px',
                                background: 'transparent', border: `1px solid ${vtGold}`, color: vtGold, borderRadius: 4,
                                textTransform: 'uppercase', letterSpacing: '0.03em', cursor: 'pointer',
                              }}
                            >
                              {copiedAsset === asset ? 'copied ✓' : 'copy'}
                            </button>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: vtMono, fontSize: 9, color: vtInkDim, textTransform: 'uppercase', marginBottom: 4 }}>
                              deposit address
                            </div>
                            <div style={{
                              fontFamily: vtMono, fontSize: 9, color: vtInk, wordBreak: 'break-all', lineHeight: 1.5,
                              background: '#0D0E0C', border: `1px solid ${vtLine}`, borderRadius: 4, padding: '6px 7px', marginBottom: 8,
                            }}>
                              {wallet.address}
                            </div>
                            <div style={{ fontFamily: vtMono, fontSize: 9, color: vtInkDim }}>
                              minimum deposit: $10.00 USD equivalent
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {isOpen && openPanel === 'export' && (
                      <div style={{ padding: '12px 2px', borderBottom: `1px solid ${vtLine}` }}>
                        <div style={{ background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 8, padding: 14 }}>
                          {!exportKey ? (
                            <>
                              <div style={{ fontFamily: vtMono, fontSize: 11.5, color: vtInk, marginBottom: 10, lineHeight: 1.5 }}>
                                this reveals your private key for {label}. anyone with it can spend
                                this wallet's funds directly — don't screenshot it, don't paste it anywhere but a wallet you trust.
                              </div>
                              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12, cursor: 'pointer' }}>
                                <input type="checkbox" checked={exportAck} onChange={(e) => setExportAck(e.target.checked)} style={{ marginTop: 2 }} />
                                <span style={{ fontFamily: vtMono, fontSize: 11, color: vtInkDim }}>
                                  i understand the risk and want to reveal this key.
                                </span>
                              </label>
                              {exportError && <VtErrorText>{exportError}</VtErrorText>}
                              <VtSmallButton onClick={() => revealExport(asset)} disabled={!exportAck || exportBusy}>
                                {exportBusy ? 'working…' : 'reveal key'}
                              </VtSmallButton>
                            </>
                          ) : (
                            <>
                              <div style={{
                                fontFamily: vtMono, fontSize: 11, color: vtGold, background: '#0D0E0C',
                                border: `1px solid ${vtLine}`, borderRadius: 4, padding: '10px 12px',
                                wordBreak: 'break-all', marginBottom: 10,
                              }}>
                                {exportKey}
                              </div>
                              <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim }}>
                                {asset === 'BTC' || asset === 'LTC' ? 'import into electrum as a wif private key.' : 'import into metamask or tronlink as a private key.'}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {isOpen && openPanel === 'send' && (
                      <div style={{ padding: '12px 2px', borderBottom: `1px solid ${vtLine}` }}>
                        <div style={{ background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 8, padding: 14 }}>
                          {sendPhase === 'done' ? (
                            <div>
                              <div style={{ fontFamily: vtMono, fontSize: 12, color: vtSage, marginBottom: 6 }}>
                                broadcast — pending confirmation.
                              </div>
                              <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, wordBreak: 'break-all' }}>
                                txid: {sendTxid}
                              </div>
                            </div>
                          ) : sendPhase === 'awaiting_confirm' ? (
                            <div>
                              <div style={{ fontFamily: vtMono, fontSize: 12, color: vtInk, marginBottom: 10 }}>
                                send {sendAmount} {asset.replace(/_.*/, '')} to{' '}
                                <span style={{ wordBreak: 'break-all', color: vtGold }}>{sendTo}</span>?
                              </div>
                              <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, marginBottom: 10 }}>
                                checked in your browser: recipient and amount match what you entered.
                                {verifiedFee !== null && (asset === 'BTC' || asset === 'LTC'
                                  ? ` network fee: ${fromBaseUnits(verifiedFee, 8)} ${asset}.`
                                  : ` maximum network fee: ${fromBaseUnits(verifiedFee, 18)} ETH.`)}
                              </div>
                              {sendError && <VtErrorText>{sendError}</VtErrorText>}
                              <div style={{ display: 'flex', gap: 8 }}>
                                <VtSmallButton onClick={() => confirmAndSend(asset)}>confirm and sign</VtSmallButton>
                                <VtSmallLink onClick={() => setSendPhase(null)}>back</VtSmallLink>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <VtTextField label="destination address" value={sendTo} onChange={(e) => setSendTo(e.target.value)} />
                              <VtTextField label={`amount (${asset.replace(/_.*/, '')})`} value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} />
                              {HAS_FEE_FIELD.has(asset) && (
                                <VtTextField
                                  label={asset === 'ETH' ? 'gas price in gwei (optional)' : 'fee rate in sat/vB (optional)'}
                                  value={sendFeeRate}
                                  onChange={(e) => setSendFeeRate(e.target.value)}
                                />
                              )}
                              {sendError && <VtErrorText>{sendError}</VtErrorText>}
                              <VtSmallButton onClick={() => startBuild(asset)} disabled={!sendTo || !sendAmount || sendPhase === 'building'}>
                                {sendPhase === 'building' ? 'preparing…' : 'continue'}
                              </VtSmallButton>
                            </div>
                          )}
                          {(sendPhase === 'signing' || sendPhase === 'broadcasting') && (
                            <div style={{ fontFamily: vtMono, fontSize: 11.5, color: vtInkDim, marginTop: 8 }}>
                              {sendPhase === 'signing' ? 'signing in your browser…' : 'broadcasting…'}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {archivedWallets.length > 0 && (
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <VtSmallLink onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'hide' : `show ${archivedWallets.length} archived wallet${archivedWallets.length === 1 ? '' : 's'}`}
            </VtSmallLink>

            {showArchived && (
              <div style={{ marginTop: 12 }}>
                <p style={{ ...subStyle, fontSize: 11, marginBottom: 10 }}>
                  these belonged to a previous password. deposits to them are still tracked here. to move funds out,
                  unlock them with the old password below.
                </p>
                <ArchivedUnlock />
                <div style={{ borderTop: `1px solid ${vtLine}` }}>
                  {archivedWallets.map((w) => {
                    const bal = archivedBalances[w.id];
                    return (
                      <div
                        key={w.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '10px 2px', borderBottom: `1px solid ${vtLine}`,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: vtMono, fontSize: 12, color: vtInkDim }}>
                            {w.asset.replace('_', ' ')}
                          </div>
                          <div style={{
                            fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, opacity: 0.7,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240,
                          }}>
                            {w.address}
                          </div>
                        </div>
                        {bal ? (
                          <div style={{ fontFamily: vtMono, fontSize: 12, color: vtInk }}>
                            {fromBaseUnits(bal.confirmed, ASSET_DECIMALS[w.asset] ?? 8)}
                          </div>
                        ) : (
                          <VtSmallLink onClick={() => showArchivedBalance(w.id)} disabled={loadingArchived === w.id}>
                            {loadingArchived === w.id ? 'loading…' : 'show balance'}
                          </VtSmallLink>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <VtSmallLink onClick={loadBalances} disabled={balancesLoading}>
            {balancesLoading ? 'loading balances…' : 'load balances'}
          </VtSmallLink>
        </div>

        <div style={{ marginTop: 18 }}>
          <a href="/wallets/transactions" style={{ fontFamily: vtMono, fontSize: 12.5, color: vtGold, textDecoration: 'underline' }}>
            view transaction history
          </a>
        </div>
      </VtPanel>
    </AppShell>
  );
}
function IconBtn({
  active, disabled, onClick, children,
}: { active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: `1px solid ${active ? vtGold : vtLine}`, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1, flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 20 20" width={12} height={12} style={{
        stroke: active ? vtGold : vtInkDim, fill: 'none', strokeWidth: 1.6,
        filter: active ? 'drop-shadow(0 0 3px rgba(201,162,39,0.8))' : 'none',
      }}>
        {children}
      </svg>
    </button>
  );
}

function toBaseUnitsFeeRate(value: string, asset: string): string {
  if (asset === 'ETH') return toBaseUnits(value, 9);
  return value;
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700,
  color: vtInk, margin: '10px 0 14px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };

function humanizeError(e: ApiError): string {
  const map: Record<string, string> = {
    wallet_not_found: 'that wallet has not been derived yet — log in again.',
    provider_unavailable: 'the blockchain provider is unavailable right now. try again shortly.',
  };
  return map[e.body?.error] ?? 'something went wrong. try again.';
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const map: Record<string, string> = {
      invalid_destination: e.body?.message ?? 'invalid destination address.',
      insufficient_native_gas: e.body?.message ?? 'insufficient balance for network fees.',
      insufficient_funds: 'not enough balance to cover the amount and fee.',
      provider_unavailable: 'the blockchain provider is unavailable right now.',
      broadcast_failed: 'the network rejected this transaction.',
      rate_limited: 'too many attempts — wait a bit and try again.',
    };
    return map[e.body?.error] ?? 'something went wrong. try again.';
  }
  if (e instanceof WithdrawalCheckError) return `not signed — the transaction from the server does not match your request: ${e.message}`;
  if (e instanceof Error && e.message === 'invalid_amount') return 'enter a valid amount.';
  return 'something went wrong. try again.';
}
