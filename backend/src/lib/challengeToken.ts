import { createSignedToken, verifySignedToken } from './signedToken';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PURPOSE = 'login_challenge';

// Challenge tokens are single-use. A successful second-factor
// login consumes the token, so the same password step cannot be replayed
// into a second session. In-memory is sufficient here: the token itself
// expires after five minutes, and a restart only forgets tokens that are
// about to die anyway.
const consumed = new Map<string, number>(); // jti -> exp

export function createChallengeToken(userId: string): string {
  return createSignedToken(PURPOSE, { userId }, CHALLENGE_TTL_MS);
}

export function verifyChallengeToken(token: string): { userId: string; jti: string } | null {
  const parsed = verifySignedToken<{ userId: string }>(PURPOSE, token);
  if (!parsed || typeof parsed.userId !== 'string') return null;
  if (consumed.has(parsed.jti)) return null;
  return { userId: parsed.userId, jti: parsed.jti };
}

export function consumeChallengeToken(jti: string): void {
  consumed.set(jti, Date.now() + CHALLENGE_TTL_MS);
}

setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of consumed) if (exp <= now) consumed.delete(jti);
}, 60_000).unref();
