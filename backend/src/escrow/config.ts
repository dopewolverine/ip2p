import 'dotenv/config';

// Spec P2 §4A.1, §8A - the platform fee address. The SERVER's copy here
// is only used to build the initial unsigned PSBT proposal; it is NOT
// the security boundary. The security boundary is the CLIENT's own
// compiled-in copy (see frontend lib/escrow/config.ts) - the client
// verifies the fee output against ITS OWN constant before signing,
// never against whatever the server's PSBT claims. An address the
// server can supply is an address the server can replace, which is
// exactly the attack this two-copies design defeats.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const escrowConfig = {
  platformFeeAddress: {
    get bitcoin() { return required('PLATFORM_FEE_ADDRESS_BTC'); },
    get litecoin() { return required('PLATFORM_FEE_ADDRESS_LTC'); },
  },
};
