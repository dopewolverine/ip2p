import type { Request } from 'express';

export class BadRequest extends Error {
  status = 400;
  constructor(public code: string) { super(code); }
}

// Route params are typed `string | undefined` under noUncheckedIndexedAccess.
// Every `:id` in this API is a UUID, so validate it here instead of letting
// a malformed value reach Postgres as an error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idParam(req: Request, name = 'id'): string {
  const v = req.params[name];
  if (!v || !UUID_RE.test(v)) throw new BadRequest('invalid_id');
  return v;
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
