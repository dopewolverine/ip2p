import { createSignedToken, verifySignedToken } from './signedToken';

const SETUP_TTL_MS = 10 * 60 * 1000;
const PURPOSE = 'totp_setup';

// Holds the not-yet-persisted secret between /totp/setup and /totp/enable,
// so an abandoned setup leaves nothing in the database.
export function createTotpSetupToken(userId: string, secret: string): string {
  return createSignedToken(PURPOSE, { userId, secret }, SETUP_TTL_MS);
}

export function verifyTotpSetupToken(token: string, userId: string): string | null {
  const parsed = verifySignedToken<{ userId: string; secret: string }>(PURPOSE, token);
  if (!parsed || parsed.userId !== userId || typeof parsed.secret !== 'string') return null;
  return parsed.secret;
}
