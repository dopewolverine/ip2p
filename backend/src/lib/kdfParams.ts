// Spec §7.4 - the single module every KDF-related value comes from.
export const RECOMMENDED_KDF_PARAMS = {
  alg: 'argon2id',
  m: 65536,
  t: 3,
  p: 1,
  version: 1,
} as const;

const FLOOR = {
  alg: 'argon2id',
  m: 19456, // OWASP baseline
  t: 2,
  p: 1,
};

// Each dimension checked independently (acceptance criterion 6g).
export function meetsKdfFloor(params: { alg: string; m: number; t: number; p: number }): boolean {
  if (params.alg !== FLOOR.alg) return false;
  if (params.m < FLOOR.m) return false;
  if (params.t < FLOOR.t) return false;
  if (params.p < FLOOR.p) return false;
  return true;
}
