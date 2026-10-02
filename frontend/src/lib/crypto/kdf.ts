import { argon2idAsync } from '@noble/hashes/argon2';

// Spec §3 / §7.4 - the ONLY place kdf_params get consumed for derivation.
// Every caller gets params from the server (GET /auth/kdf-params, a
// reset-token validation response, or a recovery-verify response) -
// never a value compiled into this frontend.
export interface KdfParams {
  alg: string;
  m: number;
  t: number;
  p: number;
  version?: number;
}

export interface DerivedKeys {
  encKey: Uint8Array;   // never leaves the caller's in-memory state
  verifier: Uint8Array; // the only half that goes over the network
}

// Spec §3.1 - one Argon2id derivation, split in half.
// The synchronous version froze the page for 2–3 seconds
// (longer on phones) - the browser looked hung. The async version yields
// to the event loop so the "working…" state actually renders.
export async function deriveKeyAndVerifier(password: string, salt: Uint8Array, params: KdfParams): Promise<DerivedKeys> {
  if (params.alg !== 'argon2id') throw new Error(`unsupported KDF alg: ${params.alg}`);

  const derived = await argon2idAsync(new TextEncoder().encode(password), salt, {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: 64,
    asyncTick: 10,
  });

  return {
    encKey: derived.slice(0, 32),
    verifier: derived.slice(32, 64),
  };
}
