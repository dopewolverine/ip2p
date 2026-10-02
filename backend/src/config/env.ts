import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function hexKey(name: string): Buffer {
  const buf = Buffer.from(required(name), 'hex');
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes, hex-encoded (64 hex characters)`);
  return buf;
}

// One switch for mainnet vs testnet. P2 §11 forbids mainnet
// trading until every asset has completed a full testnet lifecycle, so
// the same build has to be able to run against testnet. Bitcoin/Litecoin
// only for now - EVM/Tron escrow is not built yet (P2 §1 prerequisite).
const network = (process.env.IP2P_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
if (network !== 'mainnet' && network !== 'testnet') {
  throw new Error('IP2P_NETWORK must be "mainnet" or "testnet"');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  // Used for HMAC fake-salts/fake-nonces (§6.1/§7A.3), IP hashing and
  // short-lived signed tokens. Rotating it breaks nothing stored.
  serverSecret: hexKey('SERVER_SECRET'),
  // Encrypts totp_secret_enc at rest (spec §9). Rotate with
  // scripts/rotateAppEncKey.ts, which re-encrypts the stored secrets.
  appEncKey: hexKey('APP_ENC_KEY'),

  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  network,

  // Kill switches so the live site can be held closed while
  // the fixes are verified. Trading defaults to CLOSED: escrow must pass
  // the P2 §11 testnet matrix before anyone can open a trade.
  registrationOpen: process.env.REGISTRATION_OPEN !== 'false',
  tradingOpen: process.env.TRADING_OPEN === 'true',

  // The engine-testing endpoints (create a contract with any
  // counterparty and arbitrary terms) must never be reachable in
  // production. Off unless explicitly enabled on a test box.
  allowEngineTestEndpoints: process.env.NODE_ENV !== 'production' && process.env.ALLOW_ENGINE_TEST_ENDPOINTS === 'true',

  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? null,

  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        user: required('SMTP_USER'),
        pass: required('SMTP_PASS'),
        from: process.env.SMTP_FROM ?? 'no-reply@ip2p.local',
      }
    : null,
};
