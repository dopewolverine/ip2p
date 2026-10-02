import { api } from './client';

export interface WalletEntry {
  id: string;
  asset: string;
  chain: string;
  address: string;
  derivation_path: string;
  status: 'active' | 'archived';
  created_at: string;
}

export function getWalletAddresses() {
  return api.get<{ wallets: WalletEntry[] }>('/wallet/addresses');
}

export interface BalanceResponse {
  confirmed: string;
  unconfirmed: string;
  cached: boolean;
}

export function getWalletBalance(asset: string, refresh = false) {
  return api.get<BalanceResponse>(`/wallet/balance/${asset}${refresh ? '?refresh=true' : ''}`);
}

// Spec §6.3 - archived wallets stay readable; keyed by wallet id since a
// user can have more than one archived wallet for the same asset.
export function getWalletBalanceById(walletId: string, refresh = false) {
  return api.get<BalanceResponse & { status: string }>(
    `/wallet/wallets/${walletId}/balance${refresh ? '?refresh=true' : ''}`
  );
}

export interface TransactionEntry {
  direction: 'in' | 'out';
  txid: string;
  amount: string;
  fee: string | null;
  counterparty: string | null;
  confirmations: number;
  status: 'pending' | 'confirmed' | 'failed';
  created_at: string;
  confirmed_at: string | null;
  asset: string;
  chain: string;
}

export function getTransactions() {
  return api.get<{ transactions: TransactionEntry[] }>('/wallet/transactions');
}

// ---- Withdrawals (P1 §7) ----

export interface UnsignedTx {
  format: 'psbt_base64' | 'evm_tx' | 'tron_tx';
  data: unknown;
}

export function buildTransaction(params: { asset: string; to: string; amount: string; fee_rate?: string }) {
  return api.post<UnsignedTx>('/wallet/build-tx', params);
}

export function broadcastTransaction(params: {
  asset: string; signed_tx: string; to: string; amount: string; fee?: string;
}) {
  return api.post<{ txid: string }>('/wallet/broadcast', params);
}

// ---- Export (P1 §8) ----
// Carries only the asset code - never the key, in either direction. The
// actual export happens entirely client-side (see lib/crypto/exportKey.ts);
// this call exists solely for the server's rate limit and audit log.
export function requestExport(asset: string) {
  return api.post<{ status: string }>('/wallet/export', { asset });
}

export interface FiatValue {
  asset: string;
  currency: string;
  price_per_unit: number;
}

export function getWalletValue(asset: string, currency: string) {
  return api.get<FiatValue>(`/wallet/value?asset=${asset}&currency=${currency}`);
}
