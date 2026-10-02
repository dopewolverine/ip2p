import { api } from './client';

export interface Ticket {
  id: string; subject: string; status: string; priority: string;
  assigned_staff_id: string | null; created_at: string; updated_at: string;
  username?: string;
}

export interface TicketDetail extends Ticket {
  user_id: string;
  assigned_staff_username: string | null;
}

export interface TicketMessage {
  id: string; sender_type: 'user' | 'staff'; sender_id: string | null;
  body: string; attachment_id: string | null; created_at: string;
}

export function getTickets(all = false) {
  return api.get<{ tickets: Ticket[] }>(all ? '/tickets?all=true' : '/tickets');
}

export function getTicketDetail(id: string) {
  return api.get<TicketDetail>(`/tickets/${id}`);
}

export function createTicket(subject: string, body: string) {
  return api.post<{ id: string }>('/tickets', { subject, body });
}

export function getTicketMessages(id: string) {
  return api.get<{ messages: TicketMessage[] }>(`/tickets/${id}/messages`);
}

export function replyToTicket(id: string, body: string) {
  return api.post<{ status: string }>(`/tickets/${id}/messages`, { body });
}

export function closeTicket(id: string) {
  return api.post<{ status: string }>(`/tickets/${id}/close`, {});
}

export function assignTicket(id: string) {
  return api.post<{ status: string }>(`/tickets/${id}/assign`, {});
}

export async function uploadTicketAttachment(ticketId: string, file: File): Promise<{ attachment_id: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/tickets/${ticketId}/attachments`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? 'upload_failed');
  return body;
}
