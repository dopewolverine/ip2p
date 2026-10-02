import { api } from './client';

export interface DisputeListItem {
  contract_id: string; reason_code: string; opened_at: string;
  escalated_at: string | null; staff_recommendation: string | null;
  reference: string; asset: string; state: string;
}

export function getDisputes() {
  return api.get<{ disputes: DisputeListItem[] }>('/disputes');
}

export interface ResolutionView {
  contract: {
    id: string; reference: string; state: string; asset: string; chain: string;
    amount: string; fee_amount: string; fiat_amount: string; fiat_currency_code: string;
    price_snapshot: string; escrow_address: string | null; funding_txid: string | null;
    funding_confirmations: number | null;
    created_at: string; accepted_at: string | null; funded_at: string | null; paid_at: string | null; closed_at: string | null;
    payment_method: string | null; reversal_window_days: number | null; risk_tier: number | null;
  };
  payment_instructions: Array<{ id: string; details: string; created_at: string }>;
  destination_for_arbitration: { buyer_address: string | null; funder_address: string | null; buyer_id: string; funder_id: string; amount: string; asset: string };
  dispute: { reason_code: string; reason_text: string; staff_recommendation: string | null; recommendation_reason: string | null } | null;
  chat: Array<{ id: string; sender_type: string; sender_id: string | null; body: string | null; attachment_id: string | null; created_at: string }>;
  transitions: Array<{ from_state: string | null; to_state: string; actor_type: string; reason: string | null; created_at: string }>;
  evidence: Array<{ id: string; uploader_id: string; mime_type: string; original_filename: string; created_at: string }>;
  parties: {
    vendor: { id: string; username: string; account_created_at: string; completed_trades: number };
    customer: { id: string; username: string; account_created_at: string; completed_trades: number };
  };
}

export function getResolutionView(contractId: string) {
  return api.get<ResolutionView>(`/disputes/${contractId}/resolution-view`);
}

export function recommendOutcome(contractId: string, outcome: 'buyer' | 'funder', reason: string) {
  return api.post<{ status: string }>(`/disputes/${contractId}/recommend`, { outcome, reason });
}

export function decideOutcome(contractId: string, winner: 'buyer' | 'funder', reason: string) {
  return api.post<{ status: string; resolution: string }>(`/admin/escrow/contracts/${contractId}/decide`, { winner, reason });
}

export function getArbitrationProposal(contractId: string) {
  return api.get<{ contractId: string; winner: string; psbtBase64?: string; outputs: Array<{address: string | null; value: string}>; network_fee: string; status: string }>(`/admin/escrow/contracts/${contractId}/arbitration-proposal`);
}

export function submitArbitrationResolution(contractId: string, signedPsbtBase64: string) {
  return api.post<{ status: string; txid?: string }>(`/admin/escrow/contracts/${contractId}/resolve`, { signed_psbt_base64: signedPsbtBase64 });
}
