import { api } from './client';

export interface NotificationEntry {
  id: string;
  type: string;
  priority: 'critical' | 'normal' | 'low' | 'security';
  contract_id: string | null;
  payload: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

export function getNotifications() {
  return api.get<{ notifications: NotificationEntry[] }>('/notifications');
}

export function markNotificationRead(id: string) {
  return api.post<{ status: string }>(`/notifications/${id}/read`, {});
}

export interface NotificationPreferences {
  critical_web?: boolean; critical_telegram?: boolean; critical_email?: boolean;
  normal_web?: boolean; normal_telegram?: boolean; low_web?: boolean;
}

export function getPreferences() {
  return api.get<NotificationPreferences>('/notification-preferences');
}

export function updatePreferences(prefs: NotificationPreferences) {
  return api.put<{ status: string }>('/notification-preferences', prefs);
}

// ---- Telegram linking ----

export function requestTelegramLinkToken() {
  return api.post<{ token: string; expires_in: number }>('/telegram/link-token', {});
}

export function unlinkTelegram() {
  return api.post<{ status: string }>('/telegram/unlink', {});
}
