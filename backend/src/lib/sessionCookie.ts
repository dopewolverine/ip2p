import type { Response, CookieOptions } from 'express';

// The session cookie is set in one place only: HttpOnly, SameSite and
// always Secure.
const SESSION_COOKIE: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

export function setSessionCookie(res: Response, token: string): void {
  res.cookie('session', token, SESSION_COOKIE);
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _maxAge, ...rest } = SESSION_COOKIE;
  res.clearCookie('session', rest);
}
