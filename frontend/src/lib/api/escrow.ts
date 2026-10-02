import { api } from './client';

export type Party = 'vendor' | 'customer';

export interface ContractRow {
  id: string;
  reference: string;
  offer_id: string | null;
  vendor_id: string;
  customer_id: string;
  crypto_side: Party;
  asset: string;
  chain: string;
  amount: string;
  fee_amount: string;
  fee_rate_bps: number;
  fiat_amount: string;
  price_snapshot: string;
  payment_window_hours: number;
  escrow_address: string | null;
  redeem_script: string | null;
  funding_txid: string | null;
  contract_index: number | string;
  state: string;
  network_reserve: string;
  required_funding: string | null;
  payment_details: string | null;
  resolution: string | null;
  stranded_detected_at: string | null;
  release_txid: string | null;
  my_party: Party;
  payment_instructions: Array<{ id: string; details: string; created_at: string }>;
  settlement: { purpose: string; status: string; txid: string; attempts: number; last_error: string | null } | null;
}

export interface ContractKeys {
  vendor: string | null;
  customer: string | null;
  platform: string | null;
  vendor_payout: string | null;
  customer_payout: string | null;
}

export function getContractKeys(id: string) {
  return api.get<ContractKeys>(`/escrow/contracts/${id}/keys`);
}

export function getContract(id: string) {
  return api.get<ContractRow>(`/escrow/contracts/${id}`);
}

export function submitContractKey(id: string, publicKeyHex: string, derivationPath: string, payoutAddress: string) {
  return api.post<{ status: string; escrow_address?: string; witness_script?: string; network_reserve?: string; required_funding?: string }>(
    `/escrow/contracts/${id}/keys`,
    { public_key: publicKeyHex, derivation_path: derivationPath, payout_address: payoutAddress }
  );
}

export function checkFunding(id: string) {
  return api.post<{ state: string; funding_txid: string | null }>(`/escrow/contracts/${id}/check-funding`, {});
}

export interface Proposal {
  purpose: 'release' | 'refund';
  status: 'proposed' | 'partially_signed' | 'signed' | 'broadcast' | 'confirmed' | 'failed';
  psbt: string | null;
  first_signer: string | null;
  fee_rate: string | null;
  network_fee: string | null;
  txid: string | null;
}

export function createProposal(id: string, purpose: 'release' | 'refund') {
  return api.post<Proposal>(`/escrow/contracts/${id}/proposals`, { purpose });
}

export function getProposal(id: string, purpose: 'release' | 'refund') {
  return api.get<Proposal>(`/escrow/contracts/${id}/proposals/${purpose}`);
}

export function submitProposalSignature(id: string, purpose: 'release' | 'refund', signedPsbtBase64: string) {
  return api.post<{ status: string; txid?: string }>(`/escrow/contracts/${id}/proposals/${purpose}/sign`, { signed_psbt: signedPsbtBase64 });
}

export function reportSecurityAlert(id: string, check: string, details?: Record<string, unknown>) {
  return api.post<{ status: string }>(`/escrow/contracts/${id}/security-alert`, { check, details });
}

export function setPaymentDetails(id: string, details: string) {
  return api.post<{ status: string }>(`/trades/${id}/payment-details`, { details });
}
