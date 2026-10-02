import { deriveKeyAndVerifier } from './kdf';
import { base64ToBytes, bytesToBase64 } from './base64';
import { loginSalt } from '../api/auth';

// Spec §3.1.1 - step-up is password re-entry, inline on the request that
// needs it. There's no dedicated "get me a stepup salt" endpoint, so this
// reuses /auth/login/salt (safe to call while already authenticated - it
// only ever returns public KDF material) to get the current blob's salt
// and kdf_params, then re-derives the same way login does. Only the
// verifier half is used; no encryption key is needed for this.
export async function deriveStepupVerifier(username: string, password: string): Promise<string> {
  const { salt, kdf_params } = await loginSalt(username);
  const { verifier } = await deriveKeyAndVerifier(password, base64ToBytes(salt), kdf_params);
  return bytesToBase64(verifier);
}
