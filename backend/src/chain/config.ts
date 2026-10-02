import 'dotenv/config';

// Lazy on purpose: P0-only deployments (accounts/keys, no wallet features
// mounted yet) never touch anything under src/chain/, and shouldn't be
// forced to set a NOWNodes key just because this module got imported
// somewhere. The check only fires when something actually asks for the
// key - i.e. when a ChainAdapter is constructed.
function requireNowNodesApiKey(): string {
  const v = process.env.NOWNODES_API_KEY;
  if (!v) throw new Error('Missing required env var: NOWNODES_API_KEY (needed to use any chain adapter)');
  return v;
}

// Spec P1 §3.2 - NOWNodes is primary across all four chains. Blockstream
// Esplora (public, no key) is the read-only Bitcoin fallback; TronGrid the
// read-only Tron fallback. No fallback is named for Litecoin or Ethereum -
// a NOWNodes outage on those surfaces as an error rather than silently
// switching providers, consistent with "failover is read-only, broadcasts
// never fail over silently."
export const chainConfig = {
  nowNodes: {
    get apiKey() { return requireNowNodesApiKey(); },
    // Blockbook-compatible explorer APIs, one per UTXO chain.
    bitcoinBlockbookUrl: process.env.NOWNODES_BTC_BLOCKBOOK_URL ?? 'https://btcbook.nownodes.io',
    litecoinBlockbookUrl: process.env.NOWNODES_LTC_BLOCKBOOK_URL ?? 'https://ltcbook.nownodes.io',
    // Standard JSON-RPC endpoints for the account-based chains.
    ethereumRpcUrl: process.env.NOWNODES_ETH_RPC_URL ?? 'https://eth.nownodes.io',
    tronRpcUrl: process.env.NOWNODES_TRX_RPC_URL ?? 'https://trx.nownodes.io',
  },
  blockstreamFallbackUrl: process.env.BLOCKSTREAM_API_URL ?? 'https://blockstream.info/api',
  tronGrid: {
    baseUrl: process.env.TRONGRID_API_URL ?? 'https://api.trongrid.io',
    // Optional - TronGrid serves unauthenticated requests at a lower rate limit.
    apiKey: process.env.TRONGRID_API_KEY,
  },
};
