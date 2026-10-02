# iP2P — Frontend (P0, complete)

Every P0 frontend flow, wired to the real backend and real browser crypto,
in the vault-ledger design approved in the onboarding preview.

## Pages

| Route | Covers |
|---|---|
| `/` | Landing, links to everything below |
| `/register` | Form → reveal seed → confirm 3 words → active |
| `/login` | Password → TOTP (if enabled) → decrypt |
| `/forgot-password` | Request a reset email |
| `/reset-password?token=...` | Reset with or without the seed phrase |
| `/recover` | Full account + wallet recovery via seed phrase |
| `/account/security` | Enable / disable two-factor, recovery codes |
| `/account/delete` | 7-day-delayed account deletion |

## Setup

```bash
npm install
cp .env.local.example .env.local   # point BACKEND_URL at your backend if not localhost:4000
npm run dev
```

Visit http://localhost:3000. The backend must be running separately —
`/api/*` is proxied to it server-side (see `next.config.js`) so the
session cookie stays same-origin.

**Backend prerequisite:** this frontend calls `GET /auth/me`, which was
added alongside this build. If your backend predates it, add
`src/routes/me.ts` and mount it — see the chat history for the exact
patch, or ask for it again.

## Structure

```
src/
  lib/
    crypto/
      kdf.ts          Argon2id — split into encKey + verifier (spec §3.1)
      mnemonic.ts      BIP-39 generation from explicit crypto.getRandomValues entropy
      aesGcm.ts        AES-256-GCM encrypt/decrypt via WebCrypto, plus the AAD note
      recoveryKey.ts   Recovery keypair (m/44'/60'/100'/0/0) + EIP-191 signing
      stepup.ts        Re-derives a verifier from a re-entered password (§3.1.1)
      base64.ts        Uint8Array <-> base64 helpers
    api/
      client.ts        fetch wrapper (credentials: include)
      auth.ts          typed calls to every backend endpoint
  components/
    tokens.ts          design tokens (color, type)
    ui.tsx             Card, PrimaryButton, TextField, Eyebrow, Stamp, ...
    MnemonicInput.tsx   12-word entry grid (reset-with-seed, recovery)
  app/
    register/, login/, forgot-password/, reset-password/, recover/,
    account/security/, account/delete/
    layout.tsx, page.tsx, globals.css
```

## Design notes worth knowing

- **AAD is `username`, not `user_id`.** Spec §3.2 says to bind the AES-GCM
  blob to `user_id`, but the blob is encrypted client-side *before* the
  server assigns one (registration's crypto step is fully offline — spec
  §5.1 step 2 precedes step 3's POST). Username is available at encryption
  time, is unique, and doesn't change in P0, so it serves the same
  owner-binding purpose. See the comment in `aesGcm.ts`.
- **No hardcoded KDF fallback.** `getRecommendedKdfParams()` must succeed
  before registration can proceed — acceptance criterion 6i.
- **Step-up reuses `/auth/login/salt`.** The spec never defines a
  dedicated "get me a stepup salt" endpoint, and that call is safe to
  make while already authenticated (it only returns public KDF
  material) — see `lib/crypto/stepup.ts`.
- **No QR code image for TOTP setup.** Rendering one would normally mean
  either a client-side QR library (extra dependency for one screen) or a
  remote QR image API (which would mean sending the TOTP secret to a
  third party — not acceptable for this screen). The manual entry key
  and otpauth:// URI are shown as text instead; every mainstream
  authenticator app accepts manual entry.
- **Nothing touches localStorage/sessionStorage/IndexedDB.** Keys and the
  mnemonic live in React state only, for the lifetime of the component
  (spec §6.3).

## Not built yet

Recovery-code login (backend endpoint `/auth/login/recovery-code`
already exists and is wired into `lib/api/auth.ts` — just no UI entry
point yet, since it's an edge case off the main login page). Everything
from P1 onward (wallets, balances, sending crypto) — out of scope for
this phase.
