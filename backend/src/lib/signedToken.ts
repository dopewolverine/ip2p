import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { env } from '../config/env';

// Generic short-lived, tamper-evident token: base64url(payload+exp) + HMAC.
//
// Every token now carries a `purpose` that the verifier must
// match, and a random `jti`. Previously a TOTP-setup token and a login
// challenge token had overlapping shapes and were interchangeable.
export function createSignedToken(purpose: string, payload: Record<string, unknown>, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  const jti = randomBytes(12).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, purpose, jti, exp })).toString('base64url');
  const sig = createHmac('sha256', env.serverSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySignedToken<T extends Record<string, unknown>>(
  purpose: string,
  token: string
): (T & { jti: string; exp: number }) | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = createHmac('sha256', env.serverSecret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (parsed.purpose !== purpose) return null;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
    if (typeof parsed.jti !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
