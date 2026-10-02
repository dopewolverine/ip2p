import { api } from './client';

export interface ChatMessage {
  id: string;
  sender_type: 'vendor' | 'customer' | 'system' | 'staff';
  sender_id: string | null;
  body: string | null;
  attachment_id: string | null;
  created_at: string;
}

export function getMessages(contractId: string, since?: string) {
  return api.get<{ messages: ChatMessage[] }>(`/trades/${contractId}/messages${since ? `?since=${encodeURIComponent(since)}` : ''}`);
}

export function sendMessage(contractId: string, body: string) {
  return api.post<{ id: string; created_at: string; body: string; filtered: boolean }>(`/trades/${contractId}/messages`, { body });
}

export function openDispute(contractId: string, reasonCode: string, reasonText: string) {
  return api.post<{ state: string }>(`/trades/${contractId}/dispute`, { reason_code: reasonCode, reason_text: reasonText });
}

export function markPaid(contractId: string) {
  return api.post<{ state: string }>(`/escrow/contracts/${contractId}/mark-paid`, {});
}

// Multipart upload - bypasses the JSON api client on purpose (FormData
// needs its own Content-Type boundary, which fetch sets automatically
// only when we don't set Content-Type ourselves).
export async function uploadAttachment(contractId: string, file: File): Promise<{ attachment_id: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/trades/${contractId}/attachments`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? 'upload_failed');
  return body;
}

export function attachmentUrl(attachmentId: string): string {
  return `/api/attachments/${attachmentId}`;
}
