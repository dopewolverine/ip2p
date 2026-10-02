import { randomUUID } from 'crypto';

// A caller-supplied idempotency key (so a retried HTTP request reuses
// the same key and the unique constraint on contract_transitions catches
// it) falls back to a fresh one if none was supplied - still safe, just
// not retry-safe for that specific call.
export function resolveIdempotencyKey(suppliedKey: unknown): string {
  return typeof suppliedKey === 'string' && suppliedKey.length > 0 ? suppliedKey : randomUUID();
}
