import { api } from './client';
import type { KdfParams } from '../crypto/kdf';

export function checkUsername(username: string) {
  return api.post<{ available: boolean }>('/auth/register/check', { username });
}

// Spec §7.4 acceptance criterion 6i - no hardcoded fallback if this fails.
export function getRecommendedKdfParams() {
  return api.get<KdfParams>('/auth/kdf-params');
}

export interface RegisterPayload {
  username: string;
  email?: string;
  verifier: string;
  salt: string;
  iv: string;
  blob: string;
  kdf_params: KdfParams;
  recovery_address: string;
}

export function register(payload: RegisterPayload) {
  return api.post<{ user_id: string; status: string }>('/auth/register', payload);
}

export function confirmSeed() {
  return api.post<{ status: string }>('/auth/register/confirm-seed', {});
}

export interface LoginSaltResponse {
  username: string;
  salt: string;
  kdf_params: KdfParams;
}

export function loginSalt(usernameOrEmail: string) {
  return api.post<LoginSaltResponse>('/auth/login/salt', { username_or_email: usernameOrEmail });
}

export interface BlobPayload {
  username: string;
  blob: string;
  iv: string;
  salt: string;
  kdf_params: KdfParams;
  account_status?: string;
}

export type LoginResponse =
  | ({ status: 'ok' } & BlobPayload)
  | { totp_required: true; challenge_token: string };

export function login(usernameOrEmail: string, verifier: string) {
  return api.post<LoginResponse>('/auth/login', { username_or_email: usernameOrEmail, verifier });
}

export function loginTotp(challengeToken: string, code: string) {
  return api.post<{ status: 'ok' } & BlobPayload>('/auth/login/totp', { challenge_token: challengeToken, code });
}

export function loginRecoveryCode(challengeToken: string, code: string) {
  return api.post<{ status: 'ok' } & BlobPayload>('/auth/login/recovery-code', { challenge_token: challengeToken, code });
}

// ---- Password reset ----

export function passwordResetRequest(email: string) {
  return api.post<{ status: string }>('/auth/password-reset/request', { email });
}

export interface PasswordResetValidateResponse {
  valid: boolean;
  username?: string;
  kdf_params?: KdfParams;
  totp_required?: boolean;
}

export function passwordResetValidate(token: string) {
  return api.get<PasswordResetValidateResponse>(`/auth/password-reset/validate?token=${encodeURIComponent(token)}`);
}

export interface PasswordResetConfirmPayload {
  token: string;
  new_verifier: string;
  new_salt: string;
  new_iv: string;
  new_blob: string;
  new_kdf_params: KdfParams;
  new_recovery_address: string;
  totp_code?: string;
  recovery_code?: string;
}

export function passwordResetConfirm(payload: PasswordResetConfirmPayload) {
  return api.post<{ status: string }>('/auth/password-reset/confirm', payload);
}

// ---- Seed-phrase recovery ----

export function recoverChallenge(username: string) {
  return api.post<{ nonce: string; expires_at: string }>('/auth/recover/challenge', { username });
}

export function recoverVerify(username: string, signature: string) {
  return api.post<{ status: string; kdf_params: KdfParams; recovery_grant: string }>('/auth/recover/verify', { username, signature });
}

export interface RecoverSetBlobPayload {
  recovery_grant: string;
  new_verifier: string;
  new_salt: string;
  new_iv: string;
  new_blob: string;
  new_kdf_params: KdfParams;
}

export function recoverSetBlob(payload: RecoverSetBlobPayload) {
  return api.post<{ status: string }>('/auth/recover/set-blob', payload);
}

// ---- Account ----

export interface MeResponse {
  username: string;
  email: string | null;
  totp_enabled: boolean;
  status: string;
  role: string | null;
}

export function me() {
  return api.get<MeResponse>('/auth/me');
}

// ---- 2FA ----

export function totpSetup() {
  return api.post<{ setup_token: string; secret: string; otpauth_url: string }>('/auth/totp/setup');
}

export function totpEnable(setupToken: string, code: string, verifier: string) {
  return api.post<{ status: string; recovery_codes: string[] }>('/auth/totp/enable', {
    setup_token: setupToken, code, verifier,
  });
}

export function totpDisableRequest(code: string, verifier: string) {
  return api.post<{ status: string; effective_at: string }>('/auth/totp/disable/request', { code, verifier });
}

// ---- Account deletion ----

export function accountDeleteRequest(verifier: string, code?: string) {
  return api.post<{ status: string; deletion_due_at: string }>('/auth/account/delete/request', { verifier, code });
}

// ---- Wallets (P1) ----

export function submitWalletAddresses(addresses: Array<{ asset: string; address: string }>) {
  return api.post<{ status: string }>('/wallet/addresses', { addresses });
}

export function logout() {
  return api.post<{ status: string }>('/auth/logout', {});
}

// P0 §8 - change password (current password required; other sessions end).
export interface ChangePasswordPayload {
  verifier: string;
  new_verifier: string;
  new_salt: string;
  new_iv: string;
  new_blob: string;
  new_kdf_params: KdfParams;
}

export function changePassword(payload: ChangePasswordPayload) {
  return api.post<{ status: string }>('/auth/password/change', payload);
}

// P0 §7.2 - wallet blobs from before a password reset ("second chance").
export interface ArchivedBlob {
  id: string;
  blob: string;
  iv: string;
  salt: string;
  kdf_params: KdfParams;
  created_at: string;
  archived_at: string | null;
}

export function archivedWalletBlobs() {
  return api.get<{ blobs: ArchivedBlob[] }>('/auth/wallet-blobs/archived');
}
